// Mission runner for an agreed deal: start → keep `ahead` moves paid beyond what the rover has used, pay each photo
// once the rover has it. When a move is refused (budget, limits) it stops paying moves but still pays for photos
// already taken, then ends after `stallS` without a new photo; also ends on all photos delivered or the time limit.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { usdcString } from "@0xBs/hedera";
import { Seller } from "./a2a.js";
import { paidOn, type Deal } from "./negotiate.js";
import type { Expectation, Payer, PayResult } from "./payer.js";

export type Pay = (url: string, expect: Expectation) => Promise<PayResult>;

const PAY_FAILS_MAX = 5; // payments that failed in a row without a policy refusal: stop buying moves
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The seller's JSON. A network error, timeout, HTTP error or a body that isn't JSON (a proxy's error page) throws. */
async function sellerJson(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<any> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}${text.trimStart().startsWith("<") ? " (an error page)" : `: ${text.slice(0, 120)}`}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`the reply was not JSON: ${text.slice(0, 40)}…`);
  }
}

export interface MissionOptions {
  photos: number;
  ahead: number;
  maxS: number;
  pollMs?: number;
  stallS?: number;
  photoDir?: string; // save delivered photos as <dir>/<photoFile(quote, n)>
  photoFile?: (quoteId: string, n: number) => string; // default <quote>-<n>.jpg
  signal?: AbortSignal; // ends the mission early ("ended by the buyer")
  offlineS?: number; // a seller that can't be read this long ends the mission (default 90 s)
  onPayment?: (p: MissionSummary["payments"][number]) => void;
}

export interface MissionSummary {
  quote: { quote_id: string; move: string; photo: string; pay_to: string };
  moves_paid: number;
  photos_paid: number[];
  spent: string;
  stop: string;
  payments: (Omit<PayResult, "response"> & { kind: string; n?: number; photo_sha256?: string })[];
  seconds: number;
}

/** The P5/P6 path straight to one seller: RFQ and accept at list price, no negotiation. */
export async function quickDeal(sellerUrl: string, mission: string, photos: number): Promise<Deal> {
  const seller = await Seller.connect(sellerUrl);
  const quote = await seller.say({ type: "rfq", task: "parcel-inspection", mission, photos });
  const acc = await seller.say({ type: "accept", quote_id: quote.quote_id });
  return { agentId: null, name: sellerUrl, shop: seller.base, quote_id: acc.quote_id, price_move: acc.price_move, price_photo: acc.price_photo,
           payTo: acc.payTo, x402: acc.x402 };
}

export async function runMission(deal: Deal, o: MissionOptions, payer: Payer, say: (m: string) => void = () => undefined,
                                 pay: Pay = (url, e) => payer.pay(url, e)): Promise<MissionSummary> {
  const t0 = Date.now();
  if (o.photoDir) mkdirSync(o.photoDir, { recursive: true });
  const quote = { quote_id: deal.quote_id, move: deal.price_move, photo: deal.price_photo, pay_to: deal.payTo };
  const on = paidOn(deal);
  say(`deal ${quote.quote_id}: ${usdcString(quote.move)}/move, ${usdcString(quote.photo)}/photo, paid to ${on.payTo} on ${on.chain.label}`);
  const urls = deal.x402;
  const start = await fetch(urls.start!, { method: "POST" });
  if (!start.ok) {
    const text = await start.text();
    let why = text.trimStart().startsWith("<") ? "an error page came back instead of the shop's answer" : text;
    try { why = JSON.parse(text).error ?? text; } catch { /* plain text or a proxy's page */ }
    throw new Error(`the rover did not start (HTTP ${start.status}): ${why}`);
  }
  say(`mission ${quote.quote_id} started`);

  const payments: MissionSummary["payments"] = [];
  const photosPaid = new Set<number>();
  let movesPaid = 0;
  let stop = "time limit";
  let movesRefused: string | null = null;
  let lastProgress = Date.now();
  let offlineSince: number | null = null;
  let payFails = 0;
  const expect = (kind: "move" | "photo") => ({ kind, merchant: deal.shop, payTo: on.payTo, amount: quote[kind], network: on.chain.network });
  // A payment that failed on the way (not refused by our policy) is tried again, but not forever.
  const failed = (r: PayResult) => {
    if (r.ok || r.refused) return void (payFails = 0);
    if (++payFails >= PAY_FAILS_MAX && !movesRefused) {
      movesRefused = `${PAY_FAILS_MAX} payments failed in a row (${r.error ?? `HTTP ${r.status}`})`;
      lastProgress = Date.now();
    }
  };

  const settleLost = (s: any) => reconcile(payments, s, (tx, kind) => payer.confirm(tx, expect(kind)), say);

  let crash: unknown = null;
  try {
    while (Date.now() - t0 < o.maxS * 1000) {
      if (o.signal?.aborted) {
        stop = "ended by the buyer";
        break;
      }
      // Remote sellers sit behind tunnels and proxies: a status that can't be read is a pause, not the end.
      let s: any;
      try {
        s = await sellerJson(urls.status!);
        if (offlineSince) say(`seller reachable again after ${Math.round((Date.now() - offlineSince) / 1000)} s`);
        offlineSince = null;
        await settleLost(s);
      } catch (e) {
        if (!offlineSince) say(`status not read, trying again: ${(e as Error).message}`);
        offlineSince ??= Date.now();
        if (Date.now() - offlineSince > (o.offlineS ?? 90) * 1000) {
          stop = `seller unreachable for ${o.offlineS ?? 90} s`;
          break;
        }
        await sleep(2000);
        continue;
      }
      movesPaid = s.moves_paid;
      if (s.status === "ended") {
        stop = s.stop_reason ? `ended by the rover: ${s.stop_reason}` : "ended by the seller";
        break;
      }
      // Paid per the seller too: a photo whose reply was lost after it settled is paid, never bought twice.
      const paid = () => new Set([...photosPaid, ...(s.photos_paid as number[])]).size;
      for (const n of s.photos_ready as number[]) {
        if (photosPaid.has(n) || s.photos_paid.includes(n) || paid() >= o.photos) continue;
        const r = await pay(urls.photo!.replace("{n}", String(n)), expect("photo"));
        const jpeg = r.ok && r.response ? Buffer.from(await r.response.arrayBuffer()) : null;
        const sha = jpeg ? createHash("sha256").update(jpeg).digest("hex") : undefined;
        if (jpeg && o.photoDir) writeFileSync(`${o.photoDir}/${(o.photoFile ?? defaultPhotoFile)(quote.quote_id, n)}`, jpeg);
        payments.push({ ...strip(r), kind: "photo", n, ...(sha ? { photo_sha256: sha } : {}) });
        failed(r);
        o.onPayment?.(payments.at(-1)!);
        say(r.ok ? `photo ${n} paid in ${r.ms} ms: ${r.tx} (sha256 ${sha?.slice(0, 12)}…)`
          : r.tx ? `photo ${n} paid (${r.tx}) but its reply was lost: ${r.error ?? `HTTP ${r.status}`}`
          : `photo ${n} not paid: ${r.refused ?? `HTTP ${r.status}${r.error ? ` (${r.error})` : ""}`}`);
        if (r.ok) {
          photosPaid.add(n);
          lastProgress = Date.now();
        }
      }
      if (o.photos > 0 && paid() >= o.photos) {
        const lost = (s.photos_paid as number[]).filter((n) => !photosPaid.has(n));
        stop = lost.length ? `all photos paid (the reply with photo ${lost.join(", ")} was lost on the way)` : "all photos delivered";
        break;
      }
      if (movesRefused && Date.now() - lastProgress > (o.stallS ?? 25) * 1000) {
        stop = `moves refused (${movesRefused}); no new photo for ${o.stallS ?? 25} s`;
        break;
      }
      if (!movesRefused && s.moves_paid - (s.moves_used ?? 0) < o.ahead) {
        const r = await pay(urls.move!, expect("move"));
        payments.push({ ...strip(r), kind: "move" });
        failed(r);
        o.onPayment?.(payments.at(-1)!);
        say(r.ok ? `move paid in ${r.ms} ms: ${r.tx}` : `move not paid: ${r.refused ?? `HTTP ${r.status}${r.error ? ` (${r.error})` : ""}`}`);
        if (r.refused) {
          movesRefused = r.refused;
          lastProgress = Date.now();
        }
        if (r.ok) continue;
      }
      await new Promise((res) => setTimeout(res, o.pollMs ?? 500));
    }
  } catch (e) {
    crash = e;
  }
  // Always end the mission on the seller, so the rover never waits for a buyer that is gone.
  let end: any = {};
  for (let i = 1; i <= 3; i++) {
    try {
      end = await sellerJson(urls.end!, { method: "POST" });
      break;
    } catch (e) {
      say(`end not confirmed (${i}/3): ${(e as Error).message}`);
      if (i < 3) await sleep(5000);
    }
  }
  for (let i = 0; i < 4; i++) {
    const s = await sellerJson(urls.status!).catch(() => null);
    if (s && (await settleLost(s)) === 0) break;
    await sleep(5000);
  }
  if (crash) throw crash;
  return { quote: { quote_id: quote.quote_id, move: quote.move, photo: quote.photo, pay_to: quote.pay_to }, moves_paid: end.moves_paid ?? movesPaid,
           photos_paid: [...photosPaid], spent: usdcString(payer.spent), stop, payments, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

/** The seller records which transaction paid each move and photo (status move_txs, photo_txs). One with no paid entry here
 *  is a payment whose reply was lost: it is matched to its failed entry and kept only once the ledger confirms it.
 *  Returns how many seller transactions are still unconfirmed (the mirror node lags a few seconds). */
export async function reconcile(payments: MissionSummary["payments"], s: any, confirm: (tx: string, kind: "move" | "photo") => Promise<boolean>,
                                say: (m: string) => void = () => undefined): Promise<number> {
  const known = new Set(payments.filter((p) => p.ok && p.tx).map((p) => p.tx));
  const open = (kind: string, n?: number) => payments.find((p) => p.kind === kind && !p.ok && !p.refused && (n === undefined || p.n === n));
  const sellerTxs: [string, "move" | "photo", number | undefined][] = [
    ...Object.entries(s.photo_txs ?? {}).map(([n, tx]) => [String(tx), "photo", Number(n)] as [string, "photo", number]),
    ...((s.move_txs ?? []) as string[]).map((tx) => [tx, "move", undefined] as [string, "move", undefined])];
  let unresolved = 0;
  for (const [tx, kind, n] of sellerTxs) {
    const p = known.has(tx) ? undefined : open(kind, n);
    if (!p) continue;
    if (!(await confirm(tx, kind))) { unresolved++; continue; }
    Object.assign(p, { ok: true, tx, lost: true });
    known.add(tx);
    say(`${kind}${n ? ` ${n}` : ""} was paid (${tx}) but its reply was lost on the way; confirmed on the ledger`);
  }
  return unresolved;
}

const strip = ({ response: _, ...rest }: PayResult) => rest;
const defaultPhotoFile = (quoteId: string, n: number) => `${quoteId}-${n}.jpg`;


// Keep 3 moves prefunded: poll /status every 500ms;
// if paid - used < 3, pay another move.
// On a settle error, check the ledger before any retry to avoid double-pay.
const PREFUND_AHEAD = 3;
const POLL_INTERVAL_MS = 500;

async function ensurePrefunded(state: MissionState, payer: Payer) {
  const ahead = state.paid - state.used;
  if (ahead < PREFUND_AHEAD) {
    await payer.payMove(state.quoteId);
  }
}
