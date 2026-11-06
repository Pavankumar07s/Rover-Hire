// Sensor stations from the buyer's side (plan Phase 12 task 6). Found on ERC-8004 by skill, paid with the D16 limits,
// and every signed value checked (D17): it recovers to the card's signer, is at most 10 s old, comes after the last one
// seen from that signer (by t_ms, then seq: seq starts again when the station restarts), and is physically possible.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CHAINS, ERC8004, NETWORK, readCard, registrationsSince, USDC, usdcAtomic, view, type Chain } from "@0xBs/hedera";
import { verifyMessage } from "ethers";
import { evmOf, payable, rating } from "./discovery.js";
import type { Payer } from "./payer.js";

export const STATION_SKILL = "climate-reading";
export const STATION_LIMITS = { perPayment: usdcAtomic("0.02"), perCall: usdcAtomic("0.05") }; // D16
const FRESH_MS = 10_000;
const AHEAD_MS = 2_000; // clock difference allowed between the station and the buyer (both NTP)

export interface Station {
  agentId: string;
  name: string;
  payTo: string;
  shop: string;
  signer: string;
  prices: { reading: string; motion: string; history_per_min: string };
  units: Record<string, string>;
  rating: { count: number; value: number | null };
  online: boolean;
  checks: Record<string, boolean>;
  valid: boolean;
  reasons: string[];
  pay: Partial<Record<Chain, string>>; // where it can be paid: Hedera, plus each chain listed on BOTH its card and its storefront
}

async function storefront(info: string): Promise<{ payTo?: string; signer?: string; online?: boolean; pay?: { network: string; payTo: string; asset: string }[] } | null> {
  try {
    const r = await fetch(info, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? ((await r.json()) as any) : null;
  } catch {
    return null;
  }
}

/** null when the agent doesn't claim to be a station at all (a rover, or someone else's agent). */
async function inspect(agentId: string): Promise<Station | null> {
  const [uri] = await view("identity", "tokenURI", [agentId]);
  let card: any;
  try {
    card = await readCard(uri);
  } catch {
    return null;
  }
  if (!(card.skills ?? []).includes(STATION_SKILL)) return null;
  const x = card.x402 ?? {};
  const info = card.services?.find((s: any) => s.name === "info")?.endpoint ?? "";
  const [[wallet], payToEvm, front] = await Promise.all([view("identity", "getAgentWallet", [agentId]), x.payTo ? evmOf(x.payTo) : null,
                                                         info ? storefront(info) : null]);
  const checks: Record<string, boolean> = {
    registration: (card.registrations ?? []).some((r: any) => String(r.agentId) === agentId && r.agentRegistry === ERC8004.agentRegistry),
    agent_wallet_is_payto: !!payToEvm && String(wallet).toLowerCase() === payToEvm,
    active: card.active === true,
    network: x.network === NETWORK && x.asset === USDC,
    signer: /^0x[0-9a-fA-F]{40}$/.test(card.signer ?? ""),
    prices: ["reading", "motion", "history_per_min"].every((k) => /^[1-9][0-9]*$/.test(String(x.price?.[k] ?? ""))),
    storefront: !!front && front.payTo === x.payTo && String(front.signer ?? "").toLowerCase() === String(card.signer ?? "").toLowerCase(),
  };
  const reasons = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => `check failed: ${k}`);
  return { agentId, name: card.name ?? `agent #${agentId}`, pay: payable(x, front?.pay ?? []), payTo: x.payTo ?? "", shop: info.replace(/\/station\/info$/, ""),
           signer: card.signer ?? "", prices: { reading: String(x.price?.reading ?? ""), motion: String(x.price?.motion ?? ""),
           history_per_min: String(x.price?.history_per_min ?? "") }, units: card.units ?? {},
           rating: checks.registration ? await rating(agentId) : { count: 0, value: null }, online: front?.online === true,
           checks, valid: reasons.length === 0, reasons };
}

/** Every agent registered since `fromSec` whose card claims the station skill, checked. */
export async function findStations(fromSec: number): Promise<Station[]> {
  const regs = await registrationsSince(fromSec);
  const all = await Promise.all([...new Set(regs.map((r) => r.agentId))].map(inspect));
  return all.filter((s): s is Station => s !== null);
}

/** Canonical JSON (plan §3.4), byte for byte the same as the station's Python: sorted keys, no spaces, integers only. */
export function canonical(o: unknown): string {
  if (o === null || typeof o === "boolean" || typeof o === "string") return JSON.stringify(o);
  if (typeof o === "number") {
    if (!Number.isSafeInteger(o)) throw new TypeError(`not an integer: ${o} (D10)`);
    return String(o);
  }
  if (Array.isArray(o)) return `[${o.map(canonical).join(",")}]`;
  if (typeof o === "object") return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical((o as any)[k])}`).join(",")}}`;
  throw new TypeError(`cannot sign a ${typeof o}`);
}

export interface Signed { v: number; station: string; seq: number; t_ms: number; signer: string; sig: string; [k: string]: unknown }

function recoverSigner(s: Signed): string | null {
  const { sig, ...body } = s;
  try {
    return verifyMessage(canonical(body), sig);
  } catch {
    return null;
  }
}

const RANGES: Record<string, [number, number]> = { // the sensors' own datasheet ranges
  t_aht_cc: [-4000, 8500], t_bmp_cc: [-4000, 8500], rh_cpct: [0, 10000], light_raw: [0, 1023], light_pct_x100: [0, 10000],
  motion_count: [0, 2 ** 31],
};

/** Signature, format and physical ranges of one signed value; the problems found (empty = good). */
export function checkSigned(s: Signed, signer: string): string[] {
  const out: string[] = [];
  if (s.v !== 1) out.push(`unknown format v${s.v}`);
  const who = recoverSigner(s);
  if (!who || who.toLowerCase() !== signer.toLowerCase()) out.push(`seq ${s.seq}: signature recovers to ${who ?? "nothing"}, not the card's signer`);
  if (!Number.isSafeInteger(s.seq) || !Number.isSafeInteger(s.t_ms)) out.push("seq or t_ms is not an integer");
  for (const [k, [lo, hi]] of Object.entries(RANGES))
    if (k in s && !(Number.isInteger(s[k]) && (s[k] as number) >= lo && (s[k] as number) <= hi)) out.push(`seq ${s.seq}: ${k} = ${s[k]} is impossible`);
  if ("p_pa" in s && s.p_pa !== null && !(Number.isInteger(s.p_pa) && (s.p_pa as number) >= 30000 && (s.p_pa as number) <= 110000))
    out.push(`seq ${s.seq}: p_pa = ${s.p_pa} is impossible`);
  if ("motion_last_ms_ago" in s && s.motion_last_ms_ago !== null && !(Number.isInteger(s.motion_last_ms_ago) && (s.motion_last_ms_ago as number) >= 0))
    out.push(`seq ${s.seq}: motion_last_ms_ago = ${s.motion_last_ms_ago} is impossible`);
  return out;
}

/** The last value seen from each signer, so a replayed or older value is refused. A file keeps it across CLI runs. */
export class SeenStore {
  private seen: Record<string, { t_ms: number; seq: number }> = {};
  constructor(private path: string | null = null) {
    if (path && existsSync(path)) this.seen = JSON.parse(readFileSync(path, "utf8"));
  }
  problem(s: Signed): string | null {
    const last = this.seen[s.signer.toLowerCase()];
    const later = !last || s.t_ms > last.t_ms || (s.t_ms === last.t_ms && s.seq > last.seq);
    return later ? null : `seq ${s.seq} at ${s.t_ms} is not after the last one seen (seq ${last!.seq} at ${last!.t_ms}): a replay`;
  }
  remember(s: Signed): void {
    this.seen[s.signer.toLowerCase()] = { t_ms: s.t_ms, seq: s.seq };
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.seen) + "\n");
  }
}

export type SensorKind = "reading" | "motion" | "history";

export interface HistoryStats {
  samples: number;
  covered_min: number;
  from_ms: number;
  to_ms: number;
  t_aht_cc: { min: number; max: number; avg: number };
  rh_cpct: { min: number; max: number; avg: number };
  light_pct_x100: { min: number; max: number; avg: number };
  motion_events: number;
  temp_disagree: number; // samples where the two temperature sensors were more than 1.5 °C apart
}

export interface SensorBuy {
  ok: boolean; // paid, and every check passed
  kind: SensorKind;
  chain: Chain; // where it was paid
  station: { agentId: string; name: string; payTo: string; account: string; signer: string }; // payTo on the chain that paid; account: its Hedera account
  amount: string;
  tx: string | null;
  refused: string | null;
  error: string | null;
  problems: string[]; // what failed the D17 checks after paying
  warnings: string[];
  value: Signed | null; // reading or motion
  history: { minutes: number; stats: HistoryStats | null; samples: Signed[] } | null;
  raw: string | null; // the reply exactly as delivered
  sha256: string | null; // of `raw`: the station logs the same hash with the sale on its HCS topic
  spendLog: { topic: string; seq: number; txId: string } | null; // the buyer's HCS spending-log entry for this payment
  ms: number;
}

const span = (xs: number[]) => ({ min: Math.min(...xs), max: Math.max(...xs), avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) });

function checkHistory(body: any, minutes: number, station: Station, now: number): { problems: string[]; samples: Signed[]; stats: HistoryStats | null } {
  const samples: Signed[] = Array.isArray(body?.samples) ? body.samples : [];
  const every = Number(body?.every_s) || 10;
  const problems: string[] = [];
  if (!samples.length) return { problems: ["no samples"], samples, stats: null };
  for (const [i, s] of samples.entries()) {
    problems.push(...checkSigned(s, station.signer));
    if (s.t_ms < now - minutes * 60_000 - FRESH_MS || s.t_ms > now + AHEAD_MS) problems.push(`seq ${s.seq}: t_ms ${s.t_ms} is outside the ${minutes} min asked`);
    const prev = samples[i - 1];
    if (prev && !(s.t_ms > prev.t_ms && s.seq > prev.seq)) problems.push(`seq ${s.seq}: out of order after seq ${prev.seq}`);
  }
  const last = samples[samples.length - 1]!;
  if (now - last.t_ms > every * 1000 + FRESH_MS) problems.push(`the newest sample is ${Math.round((now - last.t_ms) / 1000)} s old`);
  const covered = (samples.length * every) / 60;
  if (covered < minutes * 0.9) problems.push(`only ${covered.toFixed(1)} of the ${minutes} minutes asked`);
  const col = (k: string) => samples.map((s) => s[k] as number);
  return {
    problems, samples,
    stats: { samples: samples.length, covered_min: Math.round(covered * 10) / 10, from_ms: samples[0]!.t_ms, to_ms: last.t_ms,
             t_aht_cc: span(col("t_aht_cc")), rh_cpct: span(col("rh_cpct")), light_pct_x100: span(col("light_pct_x100")),
             motion_events: last.motion_count as number - (samples[0]!.motion_count as number),
             temp_disagree: samples.filter((s) => s.temp_agree === false).length },
  };
}

/** One paid buy: the station's list price from its card, one payment, then the D17 checks on what came back. */
export async function buySensor(station: Station, kind: SensorKind, payer: Payer, seen: SeenStore, minutes = 10, chain: Chain = "hedera"): Promise<SensorBuy> {
  const amount = kind === "history" ? (BigInt(station.prices.history_per_min) * BigInt(minutes)).toString() : station.prices[kind];
  const url = `${station.shop}/station/${kind}${kind === "history" ? `?minutes=${minutes}` : ""}`;
  const merchant = `#${station.agentId} ${station.name}`;
  const payTo = station.pay[chain] ?? null; // only an address the card and the storefront agree on
  const out: SensorBuy = { ok: false, kind, chain, station: { agentId: station.agentId, name: station.name, payTo: payTo ?? station.payTo, account: station.payTo, signer: station.signer },
                           amount, tx: null, refused: null, error: null, problems: [], warnings: [], value: null, history: null,
                           raw: null, sha256: null, spendLog: null, ms: 0 };
  if (!payTo) {
    out.refused = `${station.name} does not take payment on ${CHAINS[chain].label}: its card and its storefront do not both name an address there`;
    return out;
  }
  payer.lastLog = null;
  const r = await payer.pay(url, { kind, merchant, payTo, amount, network: CHAINS[chain].network }, "GET");
  Object.assign(out, { tx: r.tx, refused: r.refused, ms: r.ms });
  const logged = payer.lastLog as Payer["lastLog"]; // pay() wrote it, after the reset above
  if (r.tx && logged?.decision === "paid") out.spendLog = { topic: logged.topic, seq: logged.seq, txId: logged.txId };
  if (!r.ok) {
    const text = r.response && r.response.status !== 402 ? await r.response.text().catch(() => "") : "";
    let why = text;
    try {
      why = JSON.parse(text).error ?? text;
    } catch {}
    out.error = r.refused ? null : [r.error ?? (r.status ? `HTTP ${r.status}` : "no answer"), why].filter(Boolean).join(": ").slice(0, 300);
    return out;
  }
  const now = Date.now();
  let body: any = null;
  out.raw = await r.response!.text().catch(() => "");
  if (out.raw) out.sha256 = createHash("sha256").update(out.raw).digest("hex");
  try {
    body = JSON.parse(out.raw);
  } catch {
    out.problems.push("the reply is not JSON");
  }
  if (body && kind === "history") {
    const h = checkHistory(body, minutes, station, now);
    out.problems.push(...h.problems);
    out.history = { minutes, stats: h.stats, samples: h.samples };
    if (h.stats?.temp_disagree) out.warnings.push(`${h.stats.temp_disagree} samples where the two temperature sensors were more than 1.5 °C apart`);
  } else if (body) {
    const s = body as Signed;
    out.problems.push(...checkSigned(s, station.signer));
    if (now - s.t_ms > FRESH_MS) out.problems.push(`the reading is ${Math.round((now - s.t_ms) / 1000)} s old (limit ${FRESH_MS / 1000} s)`);
    if (s.t_ms - now > AHEAD_MS) out.problems.push(`the reading is ${s.t_ms - now} ms in the future`);
    const replay = seen.problem(s);
    if (replay) out.problems.push(replay);
    if (s.temp_agree === false) out.warnings.push("the two temperature sensors are more than 1.5 °C apart");
    if (kind === "reading" && s.p_pa === null) out.warnings.push("no pressure: this station's pressure sensor is faulty");
    out.value = s;
    if (!out.problems.length) seen.remember(s);
  }
  out.ok = out.problems.length === 0;
  if (!out.ok) await payer.record({ decision: "data rejected", reason: out.problems.join("; ").slice(0, 200), merchant, kind, amount, tx: r.tx });
  return out;
}
