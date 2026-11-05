// One payment buys one thing. The same signed payment sent again, while it is still being served or after it settled,
// is refused before anything runs: otherwise both copies read the station (or the rover) and the second one's data,
// never delivered, could end up as the hash on the sale record.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { NextFunction, Request, Response } from "express";
import { writeDurable } from "./durable.js";

const KEEP_MS = 24 * 3600_000; // far longer than any signed payment stays valid on Hedera, Base or Solana

const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v);

/** The payment itself, whatever the JSON around it looks like: a hash of the signed part of the x402 header. */
export function paymentFingerprint(header: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const signed = decoded && typeof decoded === "object" && "payload" in decoded ? decoded.payload : decoded;
    return createHash("sha256").update(canonical(signed)).digest("hex");
  } catch {
    return null; // not a payment we can read: x402 refuses it on its own
  }
}

export const paymentHeader = (req: Request): string | undefined => req.header("payment-signature") ?? req.header("x-payment");

export class OncePerPayment {
  private serving = new Set<string>();
  private used = new Map<string, number>(); // fingerprint -> when it settled

  constructor(private file: string) {
    if (!existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
      for (const [fp, at] of Object.entries(saved)) if (Date.now() - at < KEEP_MS) this.used.set(fp, at);
    } catch (e) {
      console.error(`used payments: ${file} unreadable (${(e as Error).message}); starting empty`);
    }
  }

  /** Runs before x402: a payment already being served, or already settled, gets 409 and nothing else happens. */
  middleware = (req: Request, res: Response, next: NextFunction): void => {
    const header = paymentHeader(req);
    const fp = header ? paymentFingerprint(header) : null;
    if (!fp) return next();
    if (this.serving.has(fp) || this.used.has(fp)) {
      console.warn(`refused a payment already ${this.used.has(fp) ? "used" : "in use"} on ${req.method} ${req.path}`);
      return void res.status(409).json({ error: "this payment was already used: one payment buys one thing; sign a new one" });
    }
    this.serving.add(fp);
    res.on("close", () => this.serving.delete(fp)); // a payment that did not settle may be tried again
    next();
  };

  /** Called once the payment settled: from then on it is used for good. */
  settled(header: string | undefined): void {
    const fp = header ? paymentFingerprint(header) : null;
    if (!fp) return;
    const now = Date.now();
    this.used.set(fp, now);
    for (const [k, at] of this.used) if (now - at >= KEEP_MS) this.used.delete(k);
    writeDurable(this.file, JSON.stringify(Object.fromEntries(this.used)));
  }
}
