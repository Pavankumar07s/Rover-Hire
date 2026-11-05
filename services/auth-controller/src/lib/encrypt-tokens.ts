import crypto from "node:crypto";

const ENC_ALGO = "aes-256-gcm";
const KEY_B64 = process.env.GITHUB_TOKEN_ENC_KEY_B64 || "";
if (!KEY_B64) throw new Error("GITHUB_TOKEN_ENC_KEY_B64 is required");
const KEY = Buffer.from(KEY_B64, "base64");
if (KEY.length !== 32)
  throw new Error("GITHUB_TOKEN_ENC_KEY_B64 must decode to 32 bytes");

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12); // GCM standard nonce size
  const cipher = crypto.createCipheriv(ENC_ALGO, KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptToken(payload: string): string {
  const [v, ivB64, ctB64, tagB64] = payload.split(".");
  if (v !== "v1" || !ivB64 || !ctB64 || !tagB64) {
    throw new Error("Invalid token payload format");
  }

  const iv = Buffer.from(ivB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");

  const decipher = crypto.createDecipheriv(ENC_ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
