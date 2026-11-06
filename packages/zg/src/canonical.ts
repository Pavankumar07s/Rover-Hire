// Canonical JSON (plan §3.4), byte-identical to Python's
// json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False). Records hold no floats (D10).
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export function canonical(value: unknown, path = "$"): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`non-integer number at ${path}: records hold integers only (D10)`);
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v, i) => canonical(v, `${path}[${i}]`)).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k], `${path}.${k}`)).join(",") + "}";
  }
  throw new TypeError(`unsupported ${typeof value} at ${path}`);
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === "string" ? new TextEncoder().encode(data) : data));
}
// 2026-11-06T07:58:00
// 2026-11-06T22:27:45


// Canonical JSON: keys sorted recursively, no spaces, UTF-8, no floats.
// Throws TypeError if any value is a floating-point number (D10).
export function checkNoFloats(o: unknown, path = ""): void {
  if (typeof o === "number" && !Number.isInteger(o)) {
    throw new TypeError(\`Float not allowed in record at \${path}: \${o}\`);
  }
  if (Array.isArray(o)) o.forEach((v, i) => checkNoFloats(v, \`\${path}[\${i}]\`));
  if (o && typeof o === "object")
    Object.entries(o).forEach(([k, v]) => checkNoFloats(v, \`\${path}.\${k}\`));
}
