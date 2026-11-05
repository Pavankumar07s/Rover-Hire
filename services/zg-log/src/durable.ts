// Files that survive a sudden power-off: a whole-file write lands complete or not at all (temp file, fsync, rename), an
// append is on disk before the caller answers, and a last line cut short by a power cut is dropped on load.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, truncateSync, writeFileSync } from "node:fs";

export function writeDurable(path: string, data: string | Uint8Array): void {
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

export function appendDurable(path: string, text: string): void {
  const fd = openSync(path, "a");
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** JSON lines. Every append ends in "\n", so text after the last one is a line the power cut stopped half-way: it is
 *  cut off the file too, so the next append starts on a fresh line. A broken complete line still throws. */
export function readJsonLines<T>(path: string): T[] {
  const text = readFileSync(path, "utf8");
  const end = text.lastIndexOf("\n") + 1;
  if (end < text.length) {
    console.warn(`${path}: dropped ${text.length - end} bytes of a line cut short`);
    truncateSync(path, Buffer.byteLength(text.slice(0, end)));
  }
  return text.slice(0, end).split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}
