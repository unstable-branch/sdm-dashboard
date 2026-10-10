import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function descriptorPath(handle: FileHandle, child?: string): string {
  return child ? `/proc/self/fd/${handle.fd}/${child}` : `/proc/self/fd/${handle.fd}`;
}

/**
 * Create a target-group upload relative to retained directory descriptors.
 * Registration runs while those descriptors and the file handle remain open.
 */
export async function writeTargetGroupUpload<T>(
  uploadRoot: string,
  fileName: string,
  bytes: Buffer,
  register: (absolutePath: string, uploadedContentSha256: string) => Promise<T>,
): Promise<T> {
  if (process.platform !== "linux" || !isAbsolute(uploadRoot) || uploadRoot !== resolve(uploadRoot)
    || uploadRoot === sep || fileName.length === 0 || fileName === "." || fileName === ".."
    || fileName.includes(sep) || fileName.includes("\0")) {
    throw new Error("Unsupported or invalid target-group upload location");
  }

  const directoryHandles: FileHandle[] = [];
  let fileHandle: FileHandle | undefined;
  try {
    let current = await open(sep, DIRECTORY_FLAGS);
    directoryHandles.push(current);
    for (const component of uploadRoot.split(sep).filter(Boolean)) {
      const nextPath = descriptorPath(current, component);
      try {
        await mkdir(nextPath, { mode: 0o750 });
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      current = await open(nextPath, DIRECTORY_FLAGS);
      directoryHandles.push(current);
    }

    const parent = directoryHandles[directoryHandles.length - 1];
    const leafPath = descriptorPath(parent, fileName);
    fileHandle = await open(leafPath, FILE_FLAGS, 0o640);
    const fileStat = await fileHandle.stat();
    if (!fileStat.isFile()) throw new Error("Target-group upload is not a regular file");
    await fileHandle.writeFile(bytes);
    await fileHandle.sync();

    const uploadedContentSha256 = createHash("sha256").update(bytes).digest("hex");
    return await register(resolve(uploadRoot, fileName), uploadedContentSha256);
  } finally {
    // Failed uploads are deliberately retained. Node's pathname-based unlink
    // cannot condition deletion atomically on the open file's inode: even a
    // descriptor-relative lstat followed by unlink can delete a replacement.
    // Retention leaves an unregistered file, never a ready asset. Reconciliation
    // must happen separately under a trusted, quiescent storage boundary.
    await fileHandle?.close().catch(() => undefined);
    await Promise.all(directoryHandles.reverse().map((handle) => handle.close().catch(() => undefined)));
  }
}
