const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const helper = path.join(__dirname, '../prepare-examples.cjs');
const children = require('node:child_process');
const publisher = process.env.SDM_TEST_PUBLISHER_PATH || path.join(path.dirname(helper), 'publish-example');
const prepareExamples = (seed, target, gid) => require(helper).prepareExamples(seed, target, gid, publisher);

test('a fixture created by another writer at publication is never overwritten', () => {
  fixture((root, seed, target) => {
    const spawn = children.spawnSync;
    children.spawnSync = (...args) => {
      fs.writeFileSync(path.join(target, 'fixture.csv'), 'CONCURRENT_SAVE\n');
      return spawn(...args);
    };
    try { prepareExamples(seed, target, process.getgid()); } finally { children.spawnSync = spawn; }
    assert.equal(fs.readFileSync(path.join(target, 'fixture.csv'), 'utf8'), 'CONCURRENT_SAVE\n');
  });
});

test('successful publication leaves existing private staging objects untouched', () => {
  fixture((root, seed, target) => {
    for (const uid of [0, 1000]) {
      const dir = path.join(target, `.sdm-seed-foreign-${uid}`);
      fs.mkdirSync(dir, { mode: 0o700 });
      fs.writeFileSync(path.join(dir, 'fixture'), 'FOREIGN\n', { mode: 0o600 });
      fs.chownSync(dir, uid, 4321);
    }
    const before = [0, 1000].map(uid => fs.statSync(path.join(target, `.sdm-seed-foreign-${uid}`)));
    prepareExamples(seed, target, 2000);
    for (const [index, uid] of [0, 1000].entries()) {
      const dir = path.join(target, `.sdm-seed-foreign-${uid}`);
      assert.equal(fs.readFileSync(path.join(dir, 'fixture'), 'utf8'), 'FOREIGN\n');
      const after = fs.statSync(dir);
      for (const key of ['ino', 'dev', 'uid', 'gid', 'mode']) assert.equal(after[key], before[index][key]);
    }
    assert.equal(fs.readFileSync(path.join(target, 'fixture.csv'), 'utf8'), 'BUILT_IN\n');
    assert.equal(fs.readdirSync(target).filter(name => name.startsWith('.sdm-seed-')).length, 2);
  });
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-seed-path-'));
  const seed = path.join(root, 'seed');
  const target = path.join(root, 'target');
  fs.mkdirSync(seed);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(seed, 'fixture.csv'), 'BUILT_IN\n');
  try { run(root, seed, target); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('failed publication cannot clean a root-owned foreign stage or its member', () => {
  fixture((root, seed, target) => {
    const replacement = path.join(target, '.sdm-seed-foreign-root');
    fs.mkdirSync(replacement, { mode: 0o700 });
    fs.writeFileSync(path.join(replacement, 'fixture'), 'PREEXISTING_FOREIGN_DATA\n', { mode: 0o600 });
    const before = fs.statSync(replacement);
    const spawn = children.spawnSync;
    children.spawnSync = (command, args, options) => spawn(command, args,
      { ...options, stdio: [...options.stdio.slice(0, 3), options.stdio[4], options.stdio[4]] });
    try {
      assert.throws(() => prepareExamples(seed, target, process.getgid()), /invalid publication descriptors/);
    } finally { children.spawnSync = spawn; }
    assert.equal(fs.existsSync(replacement), true, 'foreign staging directory must survive cleanup');
    assert.equal(fs.readFileSync(path.join(replacement, 'fixture'), 'utf8'), 'PREEXISTING_FOREIGN_DATA\n');
    const after = fs.statSync(replacement);
    for (const key of ['ino', 'dev', 'uid', 'gid', 'mode']) assert.equal(after[key], before[key]);
    assert.equal(fs.existsSync(path.join(target, 'fixture.csv')), false);
  });
});

test('existing files and nested directories retain ownership and modes across starts', () => {
  fixture((root, seed, target) => {
    const nested = path.join(target, 'private-history');
    fs.mkdirSync(path.join(seed, 'private-history'));
    fs.writeFileSync(path.join(seed, 'private-history', 'new-fixture.csv'), 'BUILT_IN\n');
    fs.mkdirSync(nested);
    const saved = path.join(nested, 'saved.csv');
    const collision = path.join(target, 'fixture.csv');
    const marker = path.join(target, '.sdm-shared-permissions-v1');
    for (const file of [saved, collision, marker]) {
      fs.writeFileSync(file, 'EXISTING_PRIVATE\n');
      fs.chownSync(file, 1234, 4321);
      fs.chmodSync(file, 0o600);
    }
    fs.chownSync(nested, 1234, 4321);
    fs.chmodSync(nested, 0o700);
    const metadata = name => {
      const stat = fs.statSync(name);
      return { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777 };
    };
    const names = [nested, saved, collision, marker];
    const before = names.map(metadata);
    prepareExamples(seed, target, 2000);
    prepareExamples(seed, target, 2000);
    assert.deepEqual(names.map(metadata), before);
    for (const file of [saved, collision, marker]) {
      assert.equal(fs.readFileSync(file, 'utf8'), 'EXISTING_PRIVATE\n');
    }
    assert.equal(fs.statSync(target).gid, 2000);
    assert.equal(fs.statSync(target).mode & 0o2070, 0o2070);
  });
});

test('inaccessible legacy content stays blocked while a new fixture is readable', () => {
  fixture((root, seed, target) => {
    const legacy = path.join(target, 'legacy.csv');
    fs.writeFileSync(legacy, 'PRIVATE\n');
    fs.chownSync(legacy, 1234, 4321);
    fs.chmodSync(legacy, 0o600);
    prepareExamples(seed, target, 2000);
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    const executable = fs.openSync(process.execPath, fs.constants.O_RDONLY);
    try {
      // Pass only the owned directory descriptor so unrelated host scratch
      // ancestors do not invalidate this actual unprivileged access control.
      execFileSync('/proc/self/fd/4', ['-e', `
        const fs = require('node:fs');
        const assert = require('node:assert/strict');
        assert.equal(process.getuid(), 1000);
        assert.equal(process.getgid(), 2000);
        assert.throws(() => fs.readFileSync('/proc/self/fd/3/legacy.csv'), { code: 'EACCES' });
        assert.equal(fs.readFileSync('/proc/self/fd/3/fixture.csv', 'utf8'), 'BUILT_IN\\n');
      `], { uid: 1000, gid: 2000, cwd: '/', env: {},
        stdio: ['ignore', 'pipe', 'pipe', fd, executable], timeout: 5000 });
    } finally {
      fs.closeSync(executable);
      fs.closeSync(fd);
    }
  });
});

test('new nested seed directories allow API writes without changing the caller umask', () => {
  for (const mask of [0o022, 0o077]) {
    fixture((root, seed, target) => {
      fs.mkdirSync(path.join(seed, 'geo', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(seed, 'geo', 'nested', 'fixture.csv'), 'BUILT_IN\n');
      const previous = process.umask(mask);
      try {
        prepareExamples(seed, target, 2000);
        assert.equal(process.umask(), mask);
      } finally { process.umask(previous); }
      for (const relative of ['geo', 'geo/nested']) {
        const stat = fs.statSync(path.join(target, relative));
        assert.equal(stat.gid, 2000);
        assert.equal(stat.mode & 0o7777, 0o2775);
      }
      const fd = fs.openSync(path.join(target, 'geo', 'nested'), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      const executable = fs.openSync(process.execPath, fs.constants.O_RDONLY);
      try {
        execFileSync('/proc/self/fd/4', ['-e', `
          const fs = require('node:fs');
          const assert = require('node:assert/strict');
          assert.equal(process.getuid(), 1000);
          assert.equal(process.getgid(), 2000);
          fs.writeFileSync('/proc/self/fd/3/api-save.csv', 'API_SAVE\\n', { flag: 'wx' });
          assert.equal(fs.readFileSync('/proc/self/fd/3/api-save.csv', 'utf8'), 'API_SAVE\\n');
        `], { uid: 1000, gid: 2000, cwd: '/', env: {},
          stdio: ['ignore', 'pipe', 'pipe', fd, executable], timeout: 5000 });
      } finally {
        fs.closeSync(executable);
        fs.closeSync(fd);
      }
    });
  }
});

test('a legacy setgid parent requiring another group stays an operator-migration blocker', () => {
  fixture((root, seed, target) => {
    fs.mkdirSync(path.join(seed, 'geo', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'geo', 'nested', 'fixture.csv'), 'BUILT_IN\n');
    const legacy = path.join(target, 'geo');
    fs.mkdirSync(legacy);
    fs.chownSync(legacy, 1234, 4321);
    fs.chmodSync(legacy, 0o2775);
    const before = fs.statSync(legacy);
    const previous = process.umask();
    const group = process.getegid();
    assert.throws(() => prepareExamples(seed, target, 2000), /operator migration/);
    assert.equal(process.umask(), previous);
    assert.equal(process.getegid(), group);
    const after = fs.statSync(legacy);
    for (const key of ['ino', 'dev', 'uid', 'gid', 'mode']) assert.equal(after[key], before[key]);
    assert.deepEqual(fs.readdirSync(legacy), []);
  });
});

test('a destination symlink created at publication cannot modify another file', () => {
  fixture((root, seed, target) => {
    const outside = path.join(root, 'other-user-file.csv');
    fs.writeFileSync(outside, 'PRESERVE\n');
    const spawn = children.spawnSync;
    children.spawnSync = (...args) => {
      fs.symlinkSync(outside, path.join(target, 'fixture.csv'));
      return spawn(...args);
    };
    try { assert.throws(() => prepareExamples(seed, target, process.getgid()), /anonymous example publication refused: example publication refused: (?:Too many levels of symbolic links|Symbolic link loop)/); }
    finally { children.spawnSync = spawn; }
    assert.equal(fs.readFileSync(outside, 'utf8'), 'PRESERVE\n');
  });
});

test('a symlinked target ancestor is rejected without seeding its target', () => {
  fixture((root, seed) => {
    const outside = path.join(root, 'other-data');
    fs.mkdirSync(outside);
    const ancestor = path.join(root, 'data');
    fs.symlinkSync(outside, ancestor);
    assert.throws(() => prepareExamples(seed, path.join(ancestor, 'examples'), process.getgid()), /ENOTDIR|ELOOP/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

test('a saved file, same-name fixture and marker retain their bytes on repeated starts', () => {
  fixture((root, seed, target) => {
    fs.writeFileSync(path.join(target, 'fixture.csv'), 'USER_FIXTURE\n');
    fs.writeFileSync(path.join(target, 'saved.csv'), 'USER_SAVE\n');
    fs.writeFileSync(path.join(target, '.sdm-shared-permissions-v1'), 'OLD_MARKER\n');
    prepareExamples(seed, target, process.getgid());
    prepareExamples(seed, target, process.getgid());
    assert.equal(fs.readFileSync(path.join(target, 'fixture.csv'), 'utf8'), 'USER_FIXTURE\n');
    assert.equal(fs.readFileSync(path.join(target, 'saved.csv'), 'utf8'), 'USER_SAVE\n');
    assert.equal(fs.readFileSync(path.join(target, '.sdm-shared-permissions-v1'), 'utf8'), 'OLD_MARKER\n');
    assert.equal(fs.readdirSync(target).filter(name => name.startsWith('.sdm-seed-')).length, 0);
  });
});

test('unsupported anonymous staging fails closed without a named-file fallback', () => {
  fixture((root, seed, target) => {
    const source = fs.openSync(path.join(seed, 'fixture.csv'), fs.constants.O_RDONLY);
    const unsupported = fs.openSync('/proc', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try {
      const result = children.spawnSync(publisher, ['fixture.csv', '2000'], {
        stdio: ['ignore', 'pipe', 'pipe', source, unsupported], encoding: 'utf8', timeout: 5000
      });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /anonymous example staging unavailable/);
      assert.deepEqual(fs.readdirSync(target), []);
    } finally {
      fs.closeSync(source);
      fs.closeSync(unsupported);
    }
  });
});
