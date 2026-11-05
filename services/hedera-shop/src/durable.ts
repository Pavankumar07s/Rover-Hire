// A whole-file write that survives a sudden power-off: it lands complete or not at all (temp file, fsync, rename).
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";

export function writeDurable(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
