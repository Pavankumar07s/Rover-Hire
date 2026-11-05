import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/** Keep in sync with auth-controller and device-controller password helpers. */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const PREFIX = "scrypt";

export const MIN_PASSWORD_LENGTH = 8;

function sha256hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Hash a password with salted scrypt. */
export function hashPassword(pass: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pass, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `${PREFIX}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`${PREFIX}$`);
}

/**
 * Constant-time verify. Accepts current scrypt hashes and legacy unsalted
 * SHA-256 so existing accounts keep working until their next login.
 */
export function verifyPassword(pass: string, stored: string): boolean {
  if (stored.startsWith(`${PREFIX}$`)) {
    const parts = stored.split("$");
    if (parts.length !== 6) return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, "hex");
    const expected = Buffer.from(parts[5]!, "hex");
    if (!salt.length || !expected.length) return false;
    const actual = scryptSync(pass, salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  const a = Buffer.from(sha256hex(pass), "hex");
  const b = Buffer.from(stored, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
