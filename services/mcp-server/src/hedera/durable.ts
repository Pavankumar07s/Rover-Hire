// A whole-file write that survives a sudden power-off: it lands complete or not at all (temp file, fsync, rename).
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";

let after: ((path: string) => void) | undefined;
/** Phase 13: the remote server copies each finished write into Postgres. */
export const afterDurableWrite = (fn: (path: string) => void) => { after = fn; };

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
  after?.(path);
}
