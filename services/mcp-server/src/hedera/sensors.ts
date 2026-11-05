// Sensor station tools (plan Phase 12 task 7), on the local stdio server only: find stations on ERC-8004, and buy one
// signed reading or a stretch of history with one capped x402 payment per call (D16), every signature checked (D17).
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CHAINS, HASHSCAN, HcsLog, mirror, operatorClient, parseKey, txIdToMirror, usdcAtomic, usdcString, type Chain } from "@0xBs/hedera";
import { buySensor, findStations, Payer, SeenStore, type SensorBuy, type Signed, type Station } from "@0xBs/hedera-buyer";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buyerEnv, replayUrl, stationCallBudget, stationMaxPayment } from "./config.js";
import { missionRunning } from "./tools.js";
import { getKeys, publicAddresses } from "../wallet.js";
import { askedFor, chainFor, PAY_WITH } from "./ask.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Result => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Result => ({ content: [{ type: "text", text: t }], isError: true });
const seen = new SeenStore(join(homedir(), ".0xbs", "station-seen.json"));

let queue: Promise<unknown> = Promise.resolve(); // one sensor call at a time
const oneAtATime = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
};

async function guard(run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

let log: HcsLog | null = null;
/** The buyer's spending log: the mirror's view when it is ahead (a mission wrote since), ours when the mirror lags. */
async function spendLog(env: ReturnType<typeof buyerEnv>): Promise<HcsLog | null> {
  if (!env.spendTopic) return null;
  const fresh = await HcsLog.open(operatorClient(env.buyerId, parseKey(env.keyRaw, "HEDERA_BUYER_KEY")), env.spendTopic);
  if (!log || fresh.seq > log.seq) log = fresh;
  return log;
}

async function hashscan(tx: string): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const d: any = await mirror(`/api/v1/transactions/${txIdToMirror(tx)}`).catch(() => null);
    const ts = d?.transactions?.[0]?.consensus_timestamp;
    if (ts) return `${HASHSCAN}/transaction/${ts}`;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return `${HASHSCAN}/search-result?q=${encodeURIComponent(tx)}`;
}

const c = (cc: number) => (cc / 100).toFixed(2);
const pct = (x100: number) => `${Math.round(x100 / 100)} %`;
const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function stationLine(s: Station): string {
  const head = `#${s.agentId} ${s.name}: reading ${usdcString(s.prices.reading || "0")}, motion ${usdcString(s.prices.motion || "0")}, ` +
               `history ${usdcString(s.prices.history_per_min || "0")}/min USDC; payTo ${s.payTo}; signer ${s.signer}; ` +
               `${s.online ? "online" : "OFFLINE"}; ${s.rating.count ? `${s.rating.value}/100 from ${s.rating.count} reviews` : "no reviews yet"}; storefront ${s.shop}`;
  const chains = (Object.keys(s.pay) as Chain[]).map((c) => CHAINS[c].label).join(", ");
  return s.valid ? `✓ ${head}; pays on: ${chains}` : `✗ ${head}\n    not usable: ${s.reasons.join("; ")}`;
}

const KNOWN_MS = 10 * 60_000; // a station whose card passed every check this recently is reused, so a buy needn't re-read the whole registry
let known: { station: Station; at: number } | null = null;

async function discover(): Promise<Station[]> {
  const all = await findStations(buyerEnv().erc8004From);
  const best = all.find((s) => s.valid && s.online) ?? all.find((s) => s.valid);
  if (best) known = { station: best, at: Date.now() };
  return all;
}

async function pickStation(agentId?: string): Promise<Station> {
  const recent = known && Date.now() - known.at < KNOWN_MS && (!agentId || known.station.agentId === agentId) ? known.station : null;
  if (recent) return recent;
  const all = await discover();
  const ok = all.filter((s) => s.valid && (!agentId || s.agentId === agentId));
  if (!ok.length) throw new Error(`No usable sensor station${agentId ? ` #${agentId}` : ""} on ERC-8004. Call find_sensors to see why.`);
  const pick = ok.find((s) => s.online) ?? ok[0]!;
  known = { station: pick, at: Date.now() };
  return pick;
}

/** Set by the server that serves these tools: the remote one (Phase 14) shares its daily cap and shows receipts inline. */
export interface SensorOptions {
  remote?: boolean;
  guard?: (amount: bigint) => string | null; // a reason to refuse before paying
  spent?: (amount: bigint) => void;
}
let opts: SensorOptions = {};

async function buy(kind: "reading" | "motion" | "history", agentId: string | undefined, minutes: number | undefined, chain: Chain): Promise<{ r: SensorBuy; link: string | null; shop: string }> {
  if (missionRunning()) throw new Error("A rover mission is running and writing to the buyer's spending log; buy sensor data after it ends.");
  const env = buyerEnv();
  const station = await pickStation(agentId);
  const price = BigInt(kind === "history" ? (BigInt(station.prices.history_per_min) * BigInt(minutes ?? 10)).toString() : station.prices[kind]);
  const capped = opts.guard?.(price);
  if (capped) throw new Error(capped);
  const payer = new Payer(env.buyerId, env.keyRaw, { capPerPayment: `$${stationMaxPayment}`, budget: usdcAtomic(stationCallBudget),
                                                     perMerchant: usdcAtomic(stationCallBudget), approvalThreshold: usdcAtomic(stationMaxPayment) },
                          await spendLog(env));
  if (chain !== "hedera") await payer.addChains(getKeys()); // Base / Solana: the local wallet file, or AGENT_*_PRIVATE_KEY on the remote server
  let r = await buySensor(station, kind, payer, seen, minutes, chain);
  // x402.org sometimes fails a Base or Solana settle ("invalid_exact_evm_transaction_failed"). The payer has already read the
  // chain and found that nothing moved (r.tx is null), so one fresh payment is safe; it has its own nonce.
  if (!r.ok && !r.tx && !r.refused && chain !== "hedera") r = await buySensor(station, kind, payer, seen, minutes, chain);
  if (r.tx) opts.spent?.(BigInt(r.amount));
  const link = !r.tx ? null : chain === "hedera" ? await hashscan(r.tx) : CHAINS[chain].txUrl(r.tx);
  return { r, link, shop: station.shop };
}

function notBought(r: SensorBuy, link: string | null): Result | null {
  const who = `${r.station.name} (#${r.station.agentId})`;
  if (r.refused) return fail(`Not bought: the buyer refused before paying (${r.refused}). Nothing was signed or spent.`);
  if (r.error && r.tx) return fail(`Paid ${usdcString(r.amount)} USDC to ${who} on ${CHAINS[r.chain].label} (${link}), but its reply never arrived ` +
                                   `(${r.error}), so no data came back. The payment is in your HCS spending log; do not pay again for it.`);
  if (r.error) return fail(`${who} could not deliver: ${r.error}. It sells pay-on-success, so this call was not charged.`);
  if (r.problems.length) return fail(`Paid ${usdcString(r.amount)} USDC to ${who} (${link}), but the data FAILED the checks, so it is not ` +
                                     `shown as valid: ${r.problems.join("; ")}. This is recorded in the buyer's HCS spending log.`);
  return null;
}

const row = (k: string, v: string) => `| ${k} | ${v} |`;

/** What the user asked for, as a table: the signed values of one reading or motion count. */
function readingData(v: Signed, r: SensorBuy): string[] {
  const L = ["| What you asked | Value |", "|---|---|"];
  if (r.kind === "reading") {
    L.push(row("Temperature", `**${c(v.t_aht_cc as number)} °C** (AHT20; the BMP280 reads ${c(v.t_bmp_cc as number)} °C, ` +
                              `${v.temp_agree ? "within 1.5 °C, they agree" : "MORE than 1.5 °C apart"})`),
           row("Humidity", `**${c(v.rh_cpct as number)} %RH**`),
           row("Light", `${pct(v.light_pct_x100 as number)} (relative: 0 % = covered, 100 % = a torch against it; an LDR, not lux)`),
           row("Pressure", v.p_pa === null ? "not available (this station's pressure sensor is faulty)" : `${((v.p_pa as number) / 100).toFixed(1)} hPa`));
  }
  L.push(row("Motion", `**${v.motion_count}** event${v.motion_count === 1 ? "" : "s"} since the station's sensors started` +
                       (v.motion_last_ms_ago === null ? "" : `, the last ${ago(v.motion_last_ms_ago as number)} before this reading`)),
         row("Measured", `${clock(v.t_ms)} local time, station seq ${v.seq}`));
  for (const w of r.warnings.filter((w) => !w.startsWith("no pressure"))) L.push(row("Note", w)); // already on the Pressure row
  return L;
}

/** What the user asked for: a stretch of history, summed up, then minute by minute. */
function historyData(r: SensorBuy): string[] {
  const h = r.history!, s = h.stats!;
  const L = [`${h.minutes} min asked: ${s.samples} signed samples, one per 10 s, ${s.covered_min} min covered, ${clock(s.from_ms)}–${clock(s.to_ms)} local time.`, "",
             "| | Min | Max | Average |", "|---|---|---|---|",
             `| Temperature (°C) | ${c(s.t_aht_cc.min)} | ${c(s.t_aht_cc.max)} | ${c(s.t_aht_cc.avg)} |`,
             `| Humidity (%RH) | ${c(s.rh_cpct.min)} | ${c(s.rh_cpct.max)} | ${c(s.rh_cpct.avg)} |`,
             `| Light (relative) | ${pct(s.light_pct_x100.min)} | ${pct(s.light_pct_x100.max)} | ${pct(s.light_pct_x100.avg)} |`,
             "", `Motion events in this window: **${s.motion_events}**`, "", "Minute by minute (averages):", "",
             "| Time | °C | %RH | Light |", "|---|---|---|---|"];
  const byMin = new Map<string, Signed[]>();
  for (const x of h.samples) {
    const k = clock(x.t_ms).slice(0, 5);
    byMin.set(k, [...(byMin.get(k) ?? []), x]);
  }
  const avg = (xs: Signed[], k: string) => xs.reduce((a, x) => a + (x[k] as number), 0) / xs.length;
  for (const [k, xs] of byMin) L.push(`| ${k} | ${c(avg(xs, "t_aht_cc"))} | ${c(avg(xs, "rh_cpct"))} | ${pct(avg(xs, "light_pct_x100"))} |`);
  for (const w of r.warnings) L.push("", `Note: ${w}`);
  return L;
}

const link = (label: string, url: string) => `[${label}](${url})`;
const decode = (b64: string): any => {
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
};

/** Whether only the seller's own key can write to its sales topic: the topic's submit key is its account's key. */
async function ownTopic(topic: string, account: string): Promise<boolean> {
  const [t, a]: any[] = await Promise.all([mirror(`/api/v1/topics/${topic}`).catch(() => null), mirror(`/api/v1/accounts/${account}`).catch(() => null)]);
  return !!t?.submit_key?.key && t.submit_key.key === a?.key?.key;
}

interface SaleRecord { topic: string | null; seq: number | null; link: string | null; samePayment: boolean; own: boolean }

/** The station logs each sale on its own HCS topic with the sha256 of exactly what it delivered. Find this buy's entry:
 *  the shop writes it once the payment settles, and the mirror shows it a few seconds later. */
async function saleRecord(r: SensorBuy, shop: string): Promise<SaleRecord> {
  const health: any = await fetch(`${shop}/health`, { signal: AbortSignal.timeout(5000) }).then((x) => x.json()).catch(() => null);
  const topic = typeof health?.sales_topic === "string" ? health.sales_topic : null;
  const none = { topic, seq: null, link: null, samePayment: false, own: false };
  if (!topic || !r.sha256) return none;
  const own = await ownTopic(topic, r.station.account); // its Hedera account, whichever chain paid
  for (let i = 0; i < 12; i++) {
    const d: any = await mirror(`/api/v1/topics/${topic}/messages?order=desc&limit=10`).catch(() => null);
    for (const m of d?.messages ?? []) {
      const j = decode(m.message);
      if (j?.reading_hash !== r.sha256) continue;
      const samePayment = !!r.tx && !!j.tx && (r.chain === "hedera" ? txIdToMirror(String(j.tx)) === txIdToMirror(r.tx) : String(j.tx) === r.tx);
      return { topic, seq: typeof j.seq === "number" ? j.seq : null, link: `${HASHSCAN}/transaction/${m.consensus_timestamp}`, samePayment, own };
    }
    await new Promise((res) => setTimeout(res, 2500));
  }
  return { ...none, own };
}

/** The buyer's own address on the chain that paid. */
function fromWallet(chain: Chain, hederaId: string): string {
  if (chain === "hedera") return hederaId;
  const a = publicAddresses(getKeys());
  return (chain === "base" ? a.evm : a.solana) ?? "(no local wallet)";
}

/** Keeps the reply exactly as delivered, so anyone can hash it and find the same sha256 on the station's sale record. */
function saveReceipt(r: SensorBuy, md: string): string | null {
  if (!r.raw) return null;
  const d = new Date(), p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`; // local time, like the receipt
  const dir = join(homedir(), ".0xbs", "station", `${stamp}-${r.kind}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${r.kind}.json`), r.raw);
  writeFileSync(join(dir, "receipt.md"), md);
  return dir;
}

/** The receipt, laid out like the rover's mission report: what was asked, then a link behind every proof. */
async function receipt(r: SensorBuy, payLink: string, data: string[], shop: string): Promise<Result> {
  const env = buyerEnv();
  const [sale, spendLink] = await Promise.all([saleRecord(r, shop), r.spendLog ? hashscan(r.spendLog.txId) : Promise.resolve(null)]);
  const who = `${r.station.name} (#${r.station.agentId})`;
  const signed = r.kind === "history" ? `all ${r.history!.stats!.samples} samples signed on the station` : "signed on the station";
  const saleRow = sale.link
    ? row("**Sale record**", `sale #${sale.seq} on ${r.station.name}'s HCS topic ${sale.topic}: ${sale.samePayment ? "this payment, and " : ""}the sha256 of exactly ` +
                             `what you received${sale.own ? "; only Station-A's key can write to this topic" : ""} | ${link("message ↗", sale.link)} ✅ matches`)
    : row("**Sale record**", `${sale.topic ? `not on ${r.station.name}'s HCS topic ${sale.topic} yet: the shop writes it once the payment settles, within a minute` :
                               "the station did not say where it logs its sales"} | ${sale.topic ? link("topic ↗", `${HASHSCAN}/topic/${sale.topic}`) : "—"} ⏳`);
  const L = [`## 🌡️ ${who} · ${r.kind === "history" ? `${r.history!.minutes} min of history` : r.kind === "motion" ? "motion count" : "signed reading"}`, "",
    ...data, "",
    "## 🟣 Hedera proofs", "", "| | What it shows | Link |", "|---|---|---|",
    row("**Seller**", `ERC-8004 agent #${r.station.agentId} ${r.station.name}; paid to ${r.station.payTo}, the ${CHAINS[r.chain].label} address on its card | ` +
                      link("account ↗", CHAINS[r.chain].accountUrl(r.station.payTo))),
    row("**Payment**", `x402: ${usdcString(r.amount)} USDC on ${CHAINS[r.chain].label} from your wallet ${fromWallet(r.chain, env.buyerId)} to ` +
                       `${r.station.name}'s ${r.station.payTo}, settled, pay-on-success | ${link("transaction ↗", payLink)}`),
    row("**Signature**", `${signed} by \`${short(r.station.signer)}\`, the signer on its ERC-8004 card | ✅ checked`),
    saleRow,
    row("**Your spending log**", r.spendLog ? `entry #${r.spendLog.seq} on your HCS topic ${r.spendLog.topic}: paid ${usdcString(r.amount)} USDC to #${r.station.agentId} | ` +
                                 (spendLink ? link("message ↗", spendLink) : "—") : "not written (no spending topic set) | —"),
    "", "## 🔎 Check it yourself", ""];
  // On the remote server a file path means nothing to the user: the reply itself goes in the receipt (history is summed up above).
  const dir = opts.remote ? null : saveReceipt(r, ""); // the path goes into the text, so write the reply first and the receipt after
  if (dir && r.sha256) L.push(`- What you received, byte for byte: \`${dir}/${r.kind}.json\`. Its sha256 is \`${r.sha256}\`, the same hash as on the sale record.`);
  else if (r.sha256 && r.raw && r.kind !== "history") L.push(`- What you received, byte for byte (its sha256 is \`${r.sha256}\`, the same hash as on the sale record):`, "", "```json", r.raw, "```", "");
  else if (r.sha256) L.push(`- What you received has the sha256 \`${r.sha256}\`, the same hash as on the sale record.`);
  L.push(`- Every ${r.station.name} sale and payment, re-checked in your browser: ${replayUrl}/station/`);
  const md = L.join("\n");
  if (dir) writeFileSync(join(dir, "receipt.md"), md + "\n");
  // Like the rover's report: Claude otherwise retells it in prose and the tables and links are lost.
  return text("RECEIPT. Reply with this receipt copied exactly as Markdown: do not summarise, shorten, reword or reorder it, and " +
              "do not replace it with a file path; you may add one short sentence before it that answers the user's question." +
              (dir ? ` It is also saved as ${join(dir, "receipt.md")}.` : "") + `\n\n${md}`);
}

<<<<<<< HEAD
// No default: the user chooses the chain, the AI does not. Left out, the tool pays nothing and hands the question back.
const PAY_WITH = z.enum(["hedera", "base", "solana"]).optional()
  .describe("The chain the USER chose to pay on, all USDC on testnets: hedera (Hedera testnet), base (Base Sepolia) or solana (Solana devnet). " +
            "Ask the user on EVERY purchase, even if they chose a chain earlier in this chat, and set it only to their answer to that " +
            "question. If they have not answered for this purchase, leave it out: the tool then pays nothing and tells you to ask.");

/** Every purchase asks the user which chain to pay on. With an app that supports MCP elicitation the server asks the user
 *  itself (a chooser, the AI's suggestion pre-selected), so the AI cannot skip it; otherwise the AI must name the user's
 *  answer, and without one the tool pays nothing and hands the question back (askChain). */
async function chainFor(server: McpServer, asked: { at: number }, payWith: Chain | undefined, what: string, price: string): Promise<Chain | Result> {
  if (!server.server.getClientCapabilities()?.elicitation) {
    // No chooser in this app (Claude Desktop has none): each purchase starts with the question, and only the answer
    // that follows it within 10 minutes pays, once.
    if (payWith && Date.now() - asked.at < 10 * 60_000) {
      asked.at = 0;
      return payWith;
    }
    asked.at = Date.now();
    return askChain(what);
  }
  const r = await server.server.elicitInput({
    mode: "form",
    message: `Pay ${price} USDC to Station-A for ${what}. Which chain should pay?`,
    requestedSchema: { type: "object", required: ["chain"], properties: {
      chain: { type: "string", title: "Pay with", enum: ["hedera", "base", "solana"],
               enumNames: ["Hedera testnet", "Base Sepolia", "Solana devnet"], ...(payWith ? { default: payWith } : {}) } } },
  });
  const chain = r.action === "accept" ? (r.content?.chain as Chain | undefined) : undefined;
  return chain && chain in CHAINS ? chain : text(`Not bought: the user ${r.action === "accept" ? "chose no chain" : `chose ${r.action}`}. Nothing was paid.`);
}

/** Asked to buy without the user's choice of chain: nothing is paid, and the AI gets the question to put to the user. */
function askChain(what: string): Result {
  const a = publicAddresses(getKeys());
  return text(`NOT BOUGHT YET: nothing was paid. Every purchase needs the user's own choice of chain. If the user's LAST message ` +
              `already names the chain for this purchase, call this tool again now with payWith set to it. Otherwise ask them, in one ` +
              `short question exactly like: "Pay with Hedera, Base or Solana?", then stop and wait; do not reuse an earlier answer and ` +
              `do not choose for them. Station-A takes USDC on all three (testnets). The user's wallets: Hedera ` +
              `${buyerEnv().buyerId}${a.evm ? `, Base ${a.evm}` : ""}${a.solana ? `, Solana ${a.solana}` : ""}.`);
}

// Kept here, by user, not per MCP server: the remote server makes a new MCP server for every request, so a state held per
// server would forget the question before the answer came and ask again forever.
const askedBy = new Map<string, { at: number }>();

/** owner: the remote user's key label (Phase 13); unset locally. */
export function registerSensorTools(server: McpServer, options: SensorOptions = {}, owner?: string): void {
  opts = options;
  const key = owner ?? "local";
  if (!askedBy.has(key)) askedBy.set(key, { at: 0 });
  const asked = askedBy.get(key)!; // when this user was last asked which chain to pay on
=======
/** owner: the remote user's key label (Phase 13); unset locally. */
export function registerSensorTools(server: McpServer, options: SensorOptions = {}, owner?: string): void {
  opts = options;
  const asked = askedFor(`sensor:${owner ?? "local"}`); // when this user was last asked which chain pays for sensor data
  const ask = (what: string, price: string) => ({ seller: "Station-A", what, price, takes: "Station-A takes USDC on all three (testnets)." });
>>>>>>> 0bf3914 (rover on Hedera, Base Sepolia and Solana devnet: the user picks the chain for each mission)
  const prev = server.server.oninitialized;
  server.server.oninitialized = () => {
    prev?.();
    console.error(`[sensors] client ${JSON.stringify(server.server.getClientVersion())} can ask the user (elicitation): ${!!server.server.getClientCapabilities()?.elicitation}`);
  };
  server.registerTool(
    "find_sensors",
    {
      title: "Find sensor stations",
      description: "Find sensor stations that sell signed readings (temperature, humidity, light, motion) on the ERC-8004 " +
                   "registry (Hedera testnet), check each card (registration, agentWallet = payTo, network, a reading signer, " +
                   "live storefront with the same payTo and signer) and show list prices. Spends nothing.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => guard(async () => {
      const all = await discover();
      if (!all.length) return text("No sensor stations (skill climate-reading) registered since ERC8004_FROM.");
      return text(`${all.length} sensor station${all.length > 1 ? "s" : ""} found on ERC-8004 (✓ usable, ✗ not):\n` +
                  all.map(stationLine).join("\n") + `\nUnits: ${JSON.stringify(all[0]!.units)}` +
                  "\nBefore buying, ask the user which chain to pay on (Hedera, Base or Solana) unless they already said.");
    }),
  );

  server.registerTool(
    "buy_sensor_reading",
    {
      title: "Buy a sensor reading (spends USDC)",
      description: `SPENDS USDC: one x402 payment, at most ${stationMaxPayment} USDC, on Hedera testnet (default), Base Sepolia or Solana devnet ` +
                   "(payWith; the station's card lists where it takes payment), to a sensor station found on " +
                   "ERC-8004 (list price: reading 0.001, motion 0.0005 USDC). Returns the station's signed values, checked: the " +
                   "signature recovers to the signer on its card, the reading is at most 10 s old and newer than the last one " +
                   "seen, and the values are physically possible. Pay-on-success: a failed read is not charged. Returns a receipt: " +
                   "the values, then a link behind every proof (payment, the station's HCS sale record with the sha256 of " +
                   "exactly this reading, the buyer's spending log). Show the receipt to the user exactly as it is, as Markdown: it is " +
                   "their proof of what was paid for.",
      inputSchema: {
        kind: z.enum(["reading", "motion"]).default("reading").describe("reading: temperature, humidity, light and motion; motion: only the motion count"),
        stationId: z.string().optional().describe("ERC-8004 agentId of the station, e.g. \"136\"; defaults to the first usable one online"),
        payWith: PAY_WITH,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ kind, stationId, payWith }) => guard(() => oneAtATime(async () => {
      const what = kind === "motion" ? "a motion count" : "a reading";
      const chain = await chainFor(server, asked, payWith, ask(what, kind === "motion" ? "0.0005" : "0.001"));
      if (typeof chain !== "string") return chain;
      const { r, link, shop } = await buy(kind, stationId, undefined, chain);
      return notBought(r, link) ?? (await receipt(r, link!, readingData(r.value!, r), shop));
    })),
  );

  server.registerTool(
    "buy_sensor_history",
    {
      title: "Buy sensor history (spends USDC)",
      description: `SPENDS USDC: one x402 payment, at most ${stationMaxPayment} USDC, on Hedera testnet (default), Base Sepolia or Solana ` +
                   "devnet (payWith) (list price 0.0002 USDC per " +
                   "minute), for the last N minutes of a station's signed samples, one per 10 s. Every sample's signature is " +
                   "checked; returns min, max and average temperature, humidity and light, motion events, and a minute-by-minute " +
                   "table, then a receipt with a link behind every proof: show it to the user exactly as it is, as Markdown. Sold only when the station holds at least 90 % of the " +
                   "minutes asked; a failed read is not charged.",
      inputSchema: { minutes: z.number().int().min(1).max(60).describe("How many minutes back, 1-60"),
                     stationId: z.string().optional().describe("ERC-8004 agentId of the station; defaults to the first usable one online"),
                     payWith: PAY_WITH },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ minutes, stationId, payWith }) => guard(() => oneAtATime(async () => {
      const chain = await chainFor(server, asked, payWith, ask(`${minutes} min of history`, (minutes * 0.0002).toFixed(4)));
      if (typeof chain !== "string") return chain;
      const { r, link, shop } = await buy("history", stationId, minutes, chain);
      return notBought(r, link) ?? (await receipt(r, link!, historyData(r), shop));
    })),
  );
}
