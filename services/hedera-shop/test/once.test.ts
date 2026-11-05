import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OncePerPayment, paymentFingerprint } from "../dist/once.js";

const header = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const pay = { x402Version: 2, accepted: { network: "hedera:testnet", amount: "1000" }, payload: { transaction: "AAEC", signature: "sig-1" } };

// A request and a response just big enough for the middleware: a header lookup, a status/json pair, and "close".
function call(once: OncePerPayment, h: string | null) {
  const listeners: (() => void)[] = [];
  const out = { status: 0, body: null as unknown, passed: false, close: () => listeners.forEach((f) => f()) };
  const req = { header: (n: string) => (n === "payment-signature" ? h ?? undefined : undefined), method: "GET", path: "/station/reading" };
  const res = { status(s: number) { out.status = s; return this; }, json(b: unknown) { out.body = b; return this; }, on: (_e: string, f: () => void) => listeners.push(f) };
  once.middleware(req as never, res as never, () => { out.passed = true; });
  return out;
}

const fresh = () => new OncePerPayment(join(mkdtempSync(join(tmpdir(), "once-")), "used.json"));

test("the same payment gives the same fingerprint, whatever the JSON around it", () => {
  const reordered = { payload: { signature: "sig-1", transaction: "AAEC" }, accepted: { amount: "1000", network: "hedera:testnet" }, x402Version: 2 };
  assert.equal(paymentFingerprint(header(pay)), paymentFingerprint(header(reordered)));
  assert.notEqual(paymentFingerprint(header(pay)), paymentFingerprint(header({ ...pay, payload: { ...pay.payload, signature: "sig-2" } })));
  assert.equal(paymentFingerprint("not base64 json"), null);
});

test("a payment already being served is refused before anything runs", () => {
  const once = fresh();
  const first = call(once, header(pay));
  const second = call(once, header(pay));
  assert.ok(first.passed);
  assert.ok(!second.passed);
  assert.equal(second.status, 409);
});

test("a payment that did not settle may be tried again; a settled one never", () => {
  const once = fresh();
  call(once, header(pay)).close(); // served, not settled (e.g. the station failed)
  const retry = call(once, header(pay));
  assert.ok(retry.passed);
  once.settled(header(pay));
  retry.close();
  const again = call(once, header(pay));
  assert.ok(!again.passed);
  assert.equal(again.status, 409);
});

test("settled payments survive a restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "once-")), "used.json");
  new OncePerPayment(file).settled(header(pay));
  const after = call(new OncePerPayment(file), header(pay));
  assert.ok(!after.passed);
  assert.equal(after.status, 409);
});

test("requests without a payment pass straight through to x402", () => {
  assert.ok(call(fresh(), null).passed);
});
