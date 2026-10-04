#define _GNU_SOURCE
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Linux startup only. Descriptors 3/4 are the held seed file/target directory.
 * O_TMPFILE has no staging name: every unpublished inode dies on close. Never
 * unlink or remove a path. Unsupported filesystems fail closed, without fallback.
 */
int main(int argc, char **argv) {
  struct stat source, target;
  int temporary = -1;
  int result = 1;
  if (argc != 3 || !argv[1][0] || strchr(argv[1], '/') ||
      !strcmp(argv[1], ".") || !strcmp(argv[1], "..") || !argv[2][0]) {
    fprintf(stderr, "invalid publication arguments\n");
    return 1;
  }
  for (const unsigned char *p = (const unsigned char *)argv[2]; *p; p++) {
    if (!isdigit(*p)) {
      fprintf(stderr, "invalid publication group\n");
      return 1;
    }
  }
  errno = 0;
  char *end;
  unsigned long group = strtoul(argv[2], &end, 10);
  if (errno || *end || group > 0xfffffffeUL) {
    fprintf(stderr, "invalid publication group\n");
    return 1;
  }
  if (fstat(3, &source) || fstat(4, &target) ||
      !S_ISREG(source.st_mode) || !S_ISDIR(target.st_mode)) {
    fprintf(stderr, "invalid publication descriptors\n");
    return 1;
  }
  temporary = openat(4, ".", O_TMPFILE | O_RDWR | O_CLOEXEC, 0600);
  if (temporary < 0) {
    perror("anonymous example staging unavailable");
    return 1;
  }
  if (lseek(3, 0, SEEK_SET) < 0) goto failure;
  char buffer[16384];
  for (;;) {
    ssize_t count = read(3, buffer, sizeof(buffer));
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) goto failure;
    if (!count) break;
    ssize_t offset = 0;
    while (offset < count) {
      ssize_t written = write(temporary, buffer + offset, (size_t)(count - offset));
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) { if (!written) errno = EIO; goto failure; }
      offset += written;
    }
  }
  if (fchown(temporary, (uid_t)-1, (gid_t)group) ||
      fchmod(temporary, 0664) || fsync(temporary)) goto failure;
  char descriptor_path[64];
  snprintf(descriptor_path, sizeof(descriptor_path), "/proc/self/fd/%d", temporary);
  /* Follow only our private descriptor, never a mutable staging entry. linkat
   * publishes complete bytes and cannot replace an existing destination inode.
   */
  if (linkat(AT_FDCWD, descriptor_path, 4, argv[1], AT_SYMLINK_FOLLOW) < 0) {
    if (errno != EEXIST) goto failure;
    int existing = openat(4, argv[1], O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (existing < 0) goto failure;
    struct stat collision;
    int valid = !fstat(existing, &collision) && S_ISREG(collision.st_mode);
    close(existing);
    if (!valid) { errno = EINVAL; goto failure; }
  } else if (fsync(4)) goto failure;
  result = 0;
  goto done;
failure:
  perror("example publication refused");
done:
  if (temporary >= 0) close(temporary);
  return result;
}
