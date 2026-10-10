// Linux container startup only. Resolve directories through held descriptors,
// never through a mutable pathname after validation. No application imports.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const C = fs.constants;
const DIR = C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW;
const READ = C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK;
const at = (fd, name = '') => `/proc/self/fd/${fd}${name ? `/${name}` : ''}`;

function directory(parent, name, create, sharedGid) {
  try { return fs.openSync(at(parent, name), DIR); } catch (error) {
    if (!create || error.code !== 'ENOENT') throw error;
    if (sharedGid === undefined) {
      try { fs.mkdirSync(at(parent, name), { mode: 0o755 }); } catch (race) {
        if (race.code !== 'EEXIST') throw race;
      }
    } else {
      const stat = fs.fstatSync(parent);
      if ((stat.mode & 0o2000) && stat.gid !== sharedGid) {
        throw new Error('existing examples directory needs an explicit operator migration before seeding shared subdirectories');
      }
      // Set the creation metadata, never chmod/chown a pathname reopened after
      // mkdir: a competing writer might have replaced it with an existing dir.
      // Startup is synchronous and application code has not been loaded yet.
      const group = process.getegid();
      const mask = process.umask();
      try {
        process.setegid(sharedGid);
        process.umask(0);
        try { fs.mkdirSync(at(parent, name), { mode: 0o2775 }); } catch (race) {
          if (race.code !== 'EEXIST') throw race;
        }
      } finally {
        process.umask(mask);
        process.setegid(group);
      }
    }
    return fs.openSync(at(parent, name), DIR);
  }
}

function absoluteDirectory(value, create) {
  if (!path.isAbsolute(value) || value.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('expected an absolute directory without traversal');
  }
  let fd = fs.openSync('/', DIR);
  try {
    for (const part of value.split('/').filter(Boolean)) {
      const next = directory(fd, part, create);
      fs.closeSync(fd);
      fd = next;
    }
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}

function regular(parent, name) {
  const fd = fs.openSync(at(parent, name), READ);
  if (!fs.fstatSync(fd).isFile()) {
    fs.closeSync(fd);
    throw new Error(`not a regular file: ${name}`);
  }
  return fd;
}

function publish(source, target, name, gid, publisher) {
  // The helper copies into an anonymous inode and links its held descriptor.
  // No mutable staging path is ever written, unlinked or recursively cleaned.
  const result = childProcess.spawnSync(publisher, [name, String(gid)], {
    stdio: ['ignore', 'pipe', 'pipe', source, target],
    encoding: 'utf8', timeout: 30000, maxBuffer: 65536
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`anonymous example publication refused: ${result.stderr || result.signal || result.status}`);
  }
}

function seed(source, target, gid, publisher) {
  for (const name of fs.readdirSync(at(source)).sort()) {
    const fd = fs.openSync(at(source, name), READ);
    try {
      const stat = fs.fstatSync(fd);
      if (stat.isDirectory()) {
        const child = directory(target, name, true, gid);
        try { seed(fd, child, gid, publisher); } finally { fs.closeSync(child); }
      } else if (stat.isFile()) {
        publish(fd, target, name, gid, publisher);
      } else { throw new Error(`unsupported seed file: ${name}`); }
    } finally { fs.closeSync(fd); }
  }
}

function prepareVolumeRoot(fd, gid) {
  const stat = fs.fstatSync(fd);
  // The owner permits shared access on this volume root, not a recursive
  // migration of existing user files or nested directories. Newly published
  // fixtures receive their own group/mode in publish(). Inaccessible legacy
  // content requires an explicit operator migration, never silent broadening.
  fs.fchownSync(fd, -1, gid);
  fs.fchmodSync(fd, (stat.mode & 0o7777) | 0o2070);
}

function prepareExamples(seedPath, targetPath, gid, publisher = path.join(__dirname, 'publish-example')) {
  if (!Number.isInteger(gid) || gid < 0 || gid > 0xfffffffe) throw new Error('invalid shared group');
  const source = absoluteDirectory(seedPath, false);
  let target;
  try {
    target = absoluteDirectory(targetPath, true);
    prepareVolumeRoot(target, gid);
    seed(source, target, gid, publisher);
    const marker = '.sdm-shared-permissions-v1';
    try { fs.writeFileSync(at(target, marker), '', { flag: 'wx', mode: 0o664 }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const markerFd = regular(target, marker);
    fs.closeSync(markerFd);
  } finally {
    fs.closeSync(source);
    if (target !== undefined) fs.closeSync(target);
  }
}

module.exports = { prepareExamples };
if (require.main === module) {
  try { prepareExamples('/usr/share/sdm/examples-seed', '/app/data/examples', Number(process.env.SDM_SHARED_GID || 2000)); } catch (error) {
    console.error(`refusing unsafe examples path: ${error.message}`);
    process.exitCode = 1;
  }
}
