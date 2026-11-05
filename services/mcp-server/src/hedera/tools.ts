// Rover for Hire tools (plan §3.8): Claude finds rovers on ERC-8004 and hires one with a single call. Negotiation,
// x402 payments on Hedera, Base or Solana (through the Agent Kit tool, with its audit hook and policies) and feedback then run in this
// process in the background, so no call waits on the mission; rover_mission_status reports it, photos included.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CHAINS, chainOfTx, HASHSCAN, mirror, txIdToMirror, usdcAtomic, usdcBalance, usdcOn, usdcString, type Chain } from "@0xBs/hedera";
import { APPROVAL_THRESHOLD, CAP_PER_PAYMENT, findRovers, hire, MISSION, paidOn, type HireResult, type MissionSummary,
         type Negotiation, type Rover } from "@0xBs/hedera-buyer";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buyerEnv, estMoves, maxBudgetUsdc, zgLogUrl } from "./config.js";
import { finalizedUpdate, finalReport, stopKind, zgComplete, type MissionView } from "./report.js";
import { writeDurable } from "./durable.js";
import { askedFor, chainFor, PAY_WITH } from "./ask.js";
import { getKeys, publicAddresses } from "../wallet.js";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
type Payment = MissionSummary["payments"][number];

export const MISSIONS_DIR = join(homedir(), ".0xbs", "missions");
const PHOTO_BYTES_MAX = 900_000; // keep one status reply well under what an MCP client accepts
const GALILEO_TX = "https://chainscan-galileo.0g.ai/tx/";

interface Mission extends MissionView {
  owner?: string; // Phase 13: the remote user's key label
  chain?: Chain; // the chain the user chose to pay on (Hedera for missions saved before Phase 14)
  shopPaid?: string; // atomic USDC the shop counted for a mission cut off by a restart (the old server may have paid after our copy)
  startedAt: string;
  phase: "finding rovers" | "negotiating" | "running" | "finishing" | "ended" | "failed";
  abort: AbortController;
  error?: string;
  report?: string; // the final report, built once when everything has settled
  shownComplete?: boolean; // the first report (with ⏳ items) was returned; the next one is only the finalized update
  photosShown?: number[]; // photos already returned as images, so each one is shared in the chat as it arrives, once
}

const WAIT_MAX_S = 25; // with the report build, a call stays well under Claude Desktop's 60 s tool limit

const missions = new Map<string, Mission>();

/** Missions survive a restart of Claude Desktop: saved on every change, reloaded at startup. */
function save(m: Mission): void {
  const { abort: _a, result, consensus, ...rest } = m;
  const keep = result ? { audit: result.audit, mission: result.mission, feedback: result.feedback, feedbackError: result.feedbackError } : undefined;
  writeDurable(join(photoDir(m), "mission.json"), JSON.stringify({ ...rest, result: keep, consensus: Object.fromEntries(consensus) },
                                                                    (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
}

function loadSaved(): void {
  if (!existsSync(MISSIONS_DIR)) return;
  const saved: Mission[] = [];
  for (const id of readdirSync(MISSIONS_DIR)) {
    const file = join(MISSIONS_DIR, id, "mission.json");
    if (!existsSync(file)) continue;
    try {
      const d = JSON.parse(readFileSync(file, "utf8"));
      const m: Mission = { ...d, budget: BigInt(d.budget), consensus: new Map(Object.entries(d.consensus ?? {})), abort: new AbortController() };
      // A mission that was running when the server stopped cannot resume: its payments stopped, so the rover stopped too.
      if (!["ended", "failed"].includes(m.phase)) {
        Object.assign(m, { phase: "failed", error: "interrupted: the MCP server restarted during the mission" });
        save(m);
        // End it on the shop too, so the rover does not wait for a buyer that is gone (safe to repeat).
        const end = m.negotiation?.deal?.x402?.end;
        const deal = m.negotiation?.deal;
        if (end && deal) void fetch(end, { method: "POST", signal: AbortSignal.timeout(20_000) })
          .then(async (r) => {
            const e = (await r.json().catch(() => null)) as { ok?: boolean; moves_paid?: number; photos_paid?: Record<string, string> } | null;
            if (e?.ok) {
              const moves = e.moves_paid ?? 0, photos = Object.keys(e.photos_paid ?? {}).length;
              m.shopPaid = String(BigInt(deal.price_move) * BigInt(moves) + BigInt(deal.price_photo) * BigInt(photos));
              m.error = `interrupted: the MCP server restarted during the mission; the shop counted ${moves} moves and ${photos} photos ` +
                        `paid in total (${Number(m.shopPaid) / 1e6} USDC), and has ended the mission`;
              save(m);
            }
            console.error(`[${m.id}] interrupted mission ended on the shop: HTTP ${r.status}, shop counted ${e?.moves_paid ?? "?"} moves paid`);
          })
          .catch((e) => console.error(`[${m.id}] interrupted mission not ended on the shop: ${(e as Error).message}`));
      }
      saved.push(m);
    } catch (e) {
      console.error(`[0xbs-mcp] cannot load ${file}: ${(e as Error).message}`);
    }
  }
  for (const m of saved.sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    missions.set(m.id, m);
    if (m.phase === "ended" && !m.report) void finalize(m);
  }
}
const text = (t: string): Result => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Result => ({ content: [{ type: "text", text: t }], isError: true });

async function guard(run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

const photoDir = (m: Mission) => join(MISSIONS_DIR, m.id);
const photoPath = (m: Mission, n: number) => join(photoDir(m), `photo_${n}.jpg`);

function rate(r: Rover) {
  return r.rating.count ? `${r.rating.value}/100 from ${r.rating.count} review${r.rating.count > 1 ? "s" : ""}` : "no reviews yet";
}

function roverLine(r: Rover) {
  const takes = Object.keys(r.pay ?? {}).map((c) => CHAINS[c as Chain].label).join(", ");
  const head = `#${r.agentId} ${r.name}${r.body && !r.name.includes(r.body) ? ` (${r.body})` : ""}: list ${usdcString(r.list.move || "0")}/move + ${usdcString(r.list.photo || "0")}/photo, ` +
               `payTo ${r.payTo}${takes ? `, takes USDC on ${takes}` : ""}, ${rate(r)}, storefront ${r.shop}`;
  return r.valid ? `✓ ${head}` : `✗ ${head}\n    not usable: ${r.reasons.join("; ")}`;
}

async function hashscan(m: Mission, tx: string): Promise<string> {
  const c = chainOfTx(tx);
  if (c && c.chain !== "hedera") return c.txUrl(tx); // Base and Solana links need no lookup
  if (!m.consensus.has(tx)) {
    const d: any = await mirror(`/api/v1/transactions/${txIdToMirror(tx)}`).catch(() => null);
    const ts = d?.transactions?.[0]?.consensus_timestamp;
    if (ts) m.consensus.set(tx, ts);
  }
  const ts = m.consensus.get(tx);
  return ts ? `${HASHSCAN}/transaction/${ts}` : `${tx} (not on the mirror node yet)`;
}

function spent(m: Mission): bigint {
  const deal = m.negotiation?.deal;
  if (!deal) return 0n;
  return m.payments.filter((p) => p.ok).reduce((s, p) => s + BigInt(p.kind === "move" ? deal.price_move : deal.price_photo), 0n);
}

async function zgLog(quoteId: string) {
  const get = async (path: string) => (await fetch(`${zgLogUrl}${path}`, { signal: AbortSignal.timeout(3000) })).json() as Promise<any>;
  const [seg, rec] = await Promise.all([get(`/segments?episode_id=${quoteId}`).catch(() => null), get(`/records?episode_id=${quoteId}&last=5`).catch(() => null)]);
  return { episode: seg?.[0] ?? null, records: rec };
}

async function statusText(m: Mission): Promise<string> {
  const lines = [`Mission ${m.id}: ${m.phase}${m.error ? ` — ${m.error}` : ""}`, `Task: ${m.mission} (${m.photos} photos), budget ${usdcString(m.budget)} USDC`];
  const n = m.negotiation;
  if (n) {
    for (const o of n.offers) lines.push(`  offer #${o.agentId} ${o.name}: ` + (o.error ? `no usable offer (${o.error})`
      : `${usdcString(o.price_move!)}/move + ${usdcString(o.price_photo!)}/photo${o.meetsOffer ? " (met our counter)" : o.final ? " (final)" : ""}, expected ${usdcString(o.expected!)}`));
    for (const d of n.declined) lines.push(`  declined #${d.agentId}: ${d.reason}`);
    if (n.deal) lines.push(`Hired #${n.deal.agentId} ${n.deal.name} at ${usdcString(n.deal.price_move)}/move + ${usdcString(n.deal.price_photo)}/photo, quote ${n.deal.quote_id}`);
    else if (m.phase !== "negotiating") lines.push("No seller within budget: nothing was hired or paid.");
  }
  const deal = n?.deal;
  if (deal) {
    const live: any = m.phase === "running" ? await (await fetch(deal.x402.status!, { signal: AbortSignal.timeout(3000) })).json().catch(() => null) : null;
    const photosPaid = m.payments.filter((p) => p.kind === "photo" && p.ok).map((p) => p.n);
    lines.push(`Spent ${usdcString(spent(m))} of ${usdcString(m.budget)} USDC: ${m.payments.filter((p) => p.kind === "move" && p.ok).length} moves, ` +
               `photos paid ${photosPaid.length ? photosPaid.join(", ") : "none"}` +
               (live ? `; rover ${live.rover_state}, moves used ${live.moves_used ?? "?"} of ${live.moves_paid} paid, photos ready ${live.photos_ready.join(", ") || "none"}` : ""));
    if (m.payments.length) {
      lines.push(`Latest payments (x402, USDC on ${paidOn(deal).chain.label}; all ${m.payments.length} are in the final report):`);
      for (const p of m.payments.slice(-5)) lines.push(p.ok && p.tx ? `  ${p.kind}${p.n ? ` ${p.n}` : ""}: ${await hashscan(m, p.tx)}`
                                                          : `  ${p.kind}${p.n ? ` ${p.n}` : ""}: not paid — ${p.refused ?? `HTTP ${p.status}`}`);
    }
    const zg = await zgLog(deal.quote_id);
    if (zg.episode) {
      lines.push(`0G record: ${zg.records?.records ?? "?"} checkpoints` +
                 (zg.episode.started?.tx ? `; episode started ${GALILEO_TX}${zg.episode.started.tx}` : "; episode start being recorded on-chain") +
                 (zg.episode.ended?.tx ? `, ended ${GALILEO_TX}${zg.episode.ended.tx}` : ""));
      for (const s of zg.episode.segments ?? []) lines.push(`  segment ${s.index} (checkpoints ${s.first_seq}-${s.last_seq}): root ${s.root ?? "uploading"}` +
                                                              (s.anchor?.tx ? `, anchored ${GALILEO_TX}${s.anchor.tx}` : ""));
      for (const r of zg.records?.last ?? [])
        lines.push(`  checkpoint ${r.seq}: 0G request ${r.request_id}, ` + (r.skill ? `${r.skill}, TEE proof ${r.verified ? "verified" : "NOT verified"}`
                                                                                : `safe stop: ${stopKind(r)} (no move, so no proof needed)`));
    }
  }
  const res = m.result;
  const done = res?.mission ?? m.summary;
  if (done) lines.push(`Finished: ${done.stop} after ${done.seconds} s.`);
  if (m.phase === "finishing") lines.push("Writing the ERC-8004 feedback for the rover now (8-12 s on Hedera's JSON-RPC relay); check again shortly.");
  if (res?.feedback) lines.push(`ERC-8004 feedback ${res.feedback.score}/100 for #${deal?.agentId}: ${res.feedback.tx} (proof of payment ${(res.feedback.file as any).proofOfPayment?.txId}); ` +
                                `rating now ${res.feedback.summary.value} from ${res.feedback.summary.count}`);
  else if (m.phase === "ended" && deal) lines.push("No feedback: no photo was delivered, so there is no proof of payment to attach.");
  return lines.join("\n");
}

const paidPhotos = (m: Mission) => m.payments.filter((p) => p.kind === "photo" && p.ok && p.n).map((p) => p.n!);

/** The photos to attach: the ones not returned yet, or all; marked as shown. */
function pickPhotos(m: Mission, which: "new" | "all"): number[] {
  const pick = which === "all" ? paidPhotos(m) : paidPhotos(m).filter((n) => !m.photosShown?.includes(n));
  m.photosShown = [...new Set([...(m.photosShown ?? []), ...pick])];
  save(m);
  return pick;
}

const share = (ns: number[]) => (ns.length > 1 ? "save the attached images as files and share them, so they appear in the chat"
                                                : "save the attached image as a file and share it, so it appears in the chat");

function photos(m: Mission, pick: number[]): Content[] {
  const out: Content[] = [];
  let bytes = 0;
  for (const n of [...pick].reverse()) {
    const file = photoPath(m, n);
    if (!existsSync(file)) continue;
    const jpeg = readFileSync(file);
    if (bytes + jpeg.length > PHOTO_BYTES_MAX) {
      out.push({ type: "text", text: `photo ${n}: ${file} (not inlined, the reply would be too large)` });
      continue;
    }
    bytes += jpeg.length;
    out.push({ type: "text", text: `photo ${n} (sha256 ${m.payments.find((p) => p.n === n && p.ok)?.photo_sha256}):` },
             { type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" });
  }
  return out;
}

/** Builds and saves the final report as soon as everything has settled, whether or not Claude asks again. */
async function finalize(m: Mission): Promise<void> {
  const end = Date.now() + 10 * 60_000;
  while (!m.report && Date.now() < end) {
    if (await zgComplete(m)) {
      const env = buyerEnv();
      m.report = await finalReport(m, { spend: env.spendTopic, audit: env.auditTopic });
      writeDurable(join(photoDir(m), "report.md"), m.report);
      save(m);
      console.error(`[${m.id}] final report saved`);
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Phase 13: a remote server's check before a hire spends (its daily cap); null lets the hire go ahead. */
let spendGuard: ((budget: bigint) => string | null) | null = null;
export const setSpendGuard = (fn: typeof spendGuard) => { spendGuard = fn; };

let loaded = false; // the remote server registers the tools once per request; saved missions load only once
const ensureLoaded = () => { if (!loaded) { loaded = true; loadSaved(); } };

/** Phase 13: what a mission holds against a daily cap (atomic USDC): its whole budget while it runs, then what it may
 *  have spent, every payment not refused by our own policy (a payment whose reply was lost still counts). */
function held(m: Mission): bigint {
  if (!["ended", "failed"].includes(m.phase)) return m.budget;
  const deal = m.negotiation?.deal;
  if (!deal) return 0n;
  const ours = m.payments.filter((p) => !p.refused).reduce((sum, p) => sum + BigInt(p.kind === "move" ? deal.price_move : deal.price_photo), 0n);
  const shop = m.shopPaid ? BigInt(m.shopPaid) : 0n;
  return ours > shop ? ours : shop;
}

/** The cap in use on a UTC day (YYYY-MM-DD), read from the saved missions, so it survives restarts and frees what was not spent. */
export function capUsedOn(day: string): bigint {
  ensureLoaded();
  return [...missions.values()].filter((m) => m.startedAt.slice(0, 10) === day).reduce((sum, m) => sum + held(m), 0n);
}

/** A rover mission is writing to the buyer's spending log right now (sensor buys wait, so the HCS chain has one writer). */
export function missionRunning(): boolean {
  ensureLoaded();
  return [...missions.values()].some((m) => ["finding rovers", "negotiating", "running", "finishing"].includes(m.phase));
}

/** owner: the remote user's key label (Phase 13), so each user sees and ends only their own missions; unset locally. */
export function registerHederaTools(server: McpServer, owner?: string): void {
  ensureLoaded();
  const mine = (m: Mission) => owner === undefined || m.owner === owner;
  const asked = askedFor(`mission:${owner ?? "local"}`); // when this user was last asked which chain pays for a mission
  const ownMission = (id?: string) => {
    const m = id ? missions.get(id) : [...missions.values()].filter(mine).at(-1);
    return m && mine(m) ? m : undefined;
  };
  server.registerTool(
    "hedera_wallet_info",
    {
      title: "Hedera buyer wallet",
      description: "Show the buyer's wallets that pay rovers and sensor stations: the Hedera testnet account (id, HBAR and USDC), " +
                   "and its addresses and USDC on Base Sepolia and Solana devnet, plus the spending limits every payment is held to. " +
                   "Never shows a key.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => guard(async () => {
      const b = buyerEnv();
      const acct: any = await mirror(`/api/v1/accounts/${b.buyerId}`);
      const usdc = await usdcBalance(b.buyerId);
      const a = publicAddresses(getKeys());
      const other = async (c: "base" | "solana", address?: string) => !address ? `${CHAINS[c].label}: no key in the wallet`
        : `${CHAINS[c].label}: ${address}, ${await usdcOn(c, address).then(usdcString).catch(() => "?")} USDC`;
      return text([
        `Buyer account ${b.buyerId} (EVM ${acct?.evm_address ?? "?"}) on Hedera testnet`,
        `Balance: ${acct ? acct.balance.balance / 1e8 : "?"} HBAR, ${usdc.associated ? usdcString(usdc.balance) : "not associated with"} USDC`,
        await other("base", a.evm), await other("solana", a.solana),
        `Limits: at most ${CAP_PER_PAYMENT.replace("$", "")} USDC per payment, a payment above ${APPROVAL_THRESHOLD} USDC would need a human, ` +
        `a mission budget of at most ${maxBudgetUsdc} USDC; only the quoted payTo and the exact agreed price are ever paid`,
        `Spending log (HCS): ${b.spendTopic ?? "off"}; Agent Kit audit topic: ${b.auditTopic ?? "off"}`,
      ].join("\n"));
    }),
  );

  server.registerTool(
    "find_rovers",
    {
      title: "Find rovers for hire",
      description: "Find rovers for hire on the ERC-8004 registry (Hedera testnet), check each agent card (registration, " +
                   "agentWallet = payTo, network, skill, live storefront) and show list prices, reputation and where each takes USDC " +
                   "(Hedera, plus Base Sepolia / Solana devnet when its card and its storefront both name the address). Spends nothing.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => guard(async () => {
      const rovers = await findRovers(buyerEnv().erc8004From);
      if (!rovers.length) return text("No agents registered since ERC8004_FROM.");
      return text(`${rovers.length} agents found on ERC-8004 (✓ usable, ✗ not):\n${rovers.map(roverLine).join("\n")}`);
    }),
  );

  server.registerTool(
    "hire_rover",
    {
      title: "Hire a rover (spends USDC)",
      description: "Hire a rover to inspect a parcel. SPENDS USDC AUTONOMOUSLY up to budgetUsdc: finds rovers on " +
                   "ERC-8004, negotiates over A2A, picks the cheapest within budget that takes the chosen chain, then pays each move " +
                   "and each delivered photo with x402 in USDC on Hedera testnet, Base Sepolia or Solana devnet (payWith, the user's " +
                   `choice for this mission) in the background, with no further approval. Budget at most ${maxBudgetUsdc} USDC. ` +
                   "Returns a missionId at once; call rover_mission_status to follow it and see the photos.",
      inputSchema: {
        photos: z.number().int().min(1).max(10).describe("Photos wanted, e.g. 5"),
        budgetUsdc: z.string().describe(`Most the whole mission may spend, in USDC, e.g. "0.80" (at most ${maxBudgetUsdc})`),
        mission: z.string().optional().describe("Task for the rover. It must name the parcel's number as written on the box, " +
          "e.g. \"Inspect parcel #1 for damage\": the rover finds and photographs the parcel by that number only. Defaults to parcel #3."),
        payWith: PAY_WITH,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ photos: wanted, budgetUsdc, mission, payWith }) => guard(async () => {
      const env = buyerEnv();
      const budget = usdcAtomic(budgetUsdc.replace(/^\$/, ""));
      if (budget <= 0n || budget > usdcAtomic(maxBudgetUsdc)) return fail(`budgetUsdc must be above 0 and at most ${maxBudgetUsdc}`);
      const busy = [...missions.values()].find((m) => ["finding rovers", "negotiating", "running", "finishing"].includes(m.phase));
      if (busy) return fail(mine(busy) ? "Another mission is still running; end it first (end_rover_mission)."
                                       : "The rover is busy with someone else's mission; try again in a few minutes.");
      const capped = spendGuard?.(budget);
      if (capped) return fail(capped);
      const chain = await chainFor(server, asked, payWith, { seller: "the rover", what: `a ${wanted}-photo parcel inspection`, price: `at most ${usdcString(budget)}`,
                                                              takes: "Rovers list on their ERC-8004 card where they take USDC (find_rovers shows it)." });
      if (typeof chain !== "string") return chain;
      const m: Mission = { id: `m-${randomBytes(4).toString("hex")}`, owner, chain, mission: mission ?? MISSION, photos: wanted, budget,
                           startedAt: new Date().toISOString(), phase: "finding rovers", payments: [], consensus: new Map(), abort: new AbortController() };
      missions.set(m.id, m);
      mkdirSync(photoDir(m), { recursive: true });
      save(m);
      const keys = getKeys(); // Base / Solana: the local wallet file, or AGENT_*_PRIVATE_KEY on the remote server
      void hire(env, { mission: m.mission, photos: wanted, budget, estMoves, ahead: 3, maxS: 360, stallS: 30, photoDir: photoDir(m),
                       chain, keys: { evm: keys.evm, solana: keys.solana },
                       photoFile: (_q, n) => `photo_${n}.jpg`, signal: m.abort.signal,
                       // Look up each payment's HashScan link now, so the final report needs no lookups.
                       onPayment: (p) => { m.payments.push(p); save(m); if (p.ok && p.tx) void hashscan(m, p.tx); } },
                { say: (s) => console.error(`[${m.id}] ${s}`), onRovers: (r) => { m.rovers = r; m.phase = "negotiating"; save(m); },
                  onNegotiated: (n) => { m.negotiation = n; save(m); }, onStarted: () => { m.phase = "running"; save(m); },
                  onMissionDone: (s) => { m.summary = s; m.phase = "finishing"; save(m); } })
        .then((r) => { m.result = r; m.phase = "ended"; save(m); void finalize(m); })
        .catch((e) => { m.error = (e as Error).message; m.phase = "failed"; save(m); console.error(`[${m.id}] failed: ${m.error}`); });
      return text(`Mission ${m.id} started: finding rovers, then negotiating; budget ${usdcString(budget)} USDC for ${wanted} photos, paid on ${CHAINS[chain].label}. ` +
                  `Payments run in the background. Now call rover_mission_status with missionId "${m.id}" and waitSeconds ${WAIT_MAX_S}, ` +
                  "again each time it is still running; show each new photo in the chat as it arrives, and when it has ended show " +
                  "the user its report exactly as it is.");
    }),
  );

  server.registerTool(
    "rover_mission_status",
    {
      title: "Rover mission status",
      description: "Status of a hired rover mission. While it runs: progress and the latest payments. Once it has ended: the " +
                   "report — photos with 0G Storage download links, every payment with its link on the chain that paid it, the ERC-8004 " +
                   "identity and feedback, the HCS logs, the 0G TEE proofs, the 0G Storage segments with their on-chain anchors and " +
                   "a link to replay and verify it all — plus all photos as images. After hire_rover, call this with waitSeconds 25 " +
                   "again and again until the mission has ended, then show the report to the user exactly as it is, as Markdown: it " +
                   "is their proof of what was paid for and done. " +
                   "Each call returns as soon as a new photo is paid or the mission ends. A new photo comes back as an image: " +
                   "show it to the user in the chat right away, before the next call, as they are paying for each one live. " +
                   "A pause with no new payment for a minute or two is normal (the rover holds still and asks its AI again) and " +
                   "costs nothing: keep calling this tool, and never end the mission unless the user asks.",
      inputSchema: {
        missionId: z.string().optional().describe("From hire_rover; defaults to the latest mission"),
        photos: z.enum(["new", "all"]).optional().describe("Which paid photos to include as images: new (default), the ones not returned yet; all, every paid photo"),
        waitSeconds: z.number().int().min(0).max(WAIT_MAX_S).optional()
          .describe(`Wait up to this many seconds (max ${WAIT_MAX_S}) for the mission to end before answering`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ missionId, photos: which, waitSeconds }) => guard(async () => {
      const m = ownMission(missionId);
      if (!m) return fail(missionId ? `No mission ${missionId} in this session.` : "No mission has been started in this session.");
      // Answer as soon as there is news (a new photo paid, the mission done, everything settled) rather than waiting the full time.
      const until = Date.now() + Math.min(waitSeconds ?? 0, WAIT_MAX_S) * 1000;
      const photosNow = () => m.payments.filter((p) => p.kind === "photo" && p.ok).length;
      const seen = photosNow();
      const settled = async () => m.phase === "ended" && (await zgComplete(m));
      const done = () => ["finishing", "ended", "failed"].includes(m.phase);
      while (Date.now() < until && !done() && photosNow() === seen) await new Promise((r) => setTimeout(r, 1000));
      if (!done()) {
        // A live run: polled with photos "none", all five photos reached the chat only with the final report.
        const pick = pickPhotos(m, which ?? "new");
        const head = pick.length ? `NEW PHOTO ${pick.join(", ")} of ${m.photos}, paid and delivered. Show ${pick.length > 1 ? "them" : "it"} to the user now, before calling again: ` +
          `${share(pick)}, with one line saying which photo ${pick.length > 1 ? "each is" : "it is"}. Then call rover_mission_status again with waitSeconds ${WAIT_MAX_S}.\n\n` : "";
        return { content: [{ type: "text", text: head + (await statusText(m)) }, ...photos(m, pick)] };
      }
      if (m.phase === "failed") return { content: [{ type: "text", text: await statusText(m) }, ...photos(m, pickPhotos(m, "all"))] };
      // Once the first report was shown, wait for the settling items rather than answering with nothing new.
      while (m.shownComplete && !m.report && Date.now() < until && !(await settled())) await new Promise((r) => setTimeout(r, 2000));
      const env = buyerEnv();
      const topics = { spend: env.spendTopic, audit: env.auditTopic };
      if (!m.report && (await settled())) {
        m.report = await finalReport(m, topics);
        writeDurable(join(photoDir(m), "report.md"), m.report);
        save(m);
      }
      const files = m.payments.filter((p) => p.kind === "photo" && p.ok).map((p) => photoPath(m, p.n!)).join(", ");
      if (m.report && m.shownComplete && which !== "all") {
        return text(`FINALIZED. Show this final report to the user in place of the earlier one (it is the same report with nothing left ⏳), copied exactly as Markdown: do not summarise, shorten, reword or reorder it, and do not replace it with a file path; you may add one short sentence before it. ` +
                    `It is also saved as ${join(photoDir(m), "report.md")}.\n\n${finalizedUpdate(m.report)}`);
      }
      const first = !m.shownComplete || which === "all";
      m.shownComplete = true;
      // The photos were shared as they arrived; the report attaches only any not shown yet (or all, when asked).
      const pick = first ? pickPhotos(m, which ?? "new") : [];
      const photoStep = pick.length
        ? `(1) the photo${pick.length > 1 ? "s" : ""} ${pick.join(", ")} attached to this result as images (they paid for them and want to ` +
          `see them in the chat, not only as file paths: ${share(pick)}); (2) `
        : "this report — the photos were already shared as they arrived, so do not share them again — ";
      const report = m.report ?? (await finalReport(m, topics, { feedbackPending: m.phase === "finishing" }));
      const saved = `On the host computer the photos are also at: ${files}; the report is saved as ${join(photoDir(m), "report.md")}.`;
      const head = m.report
        ? `FINAL REPORT. Reply with ${pick.length ? "in this order: " : ""}${photoStep}${pick.length ? "this report, " : ""}copied exactly as Markdown: do not summarise, shorten, reword or reorder it, and do not replace it with a file path; you may add one short sentence before it. ${saved}`
        : `MISSION COMPLETE. Reply with ${pick.length ? "in this order: " : ""}${photoStep}${pick.length ? "this report, " : ""}copied exactly as Markdown: do not summarise, shorten, reword or reorder it, and do not replace it with a file path; you may add one short sentence before it. ${saved} Items marked ⏳ (the last 0G Storage uploads and anchors, the rover's rating) settle ` +
          "within about a minute. The user is waiting for those final on-chain proofs: after showing the report, you MUST call " +
          `rover_mission_status again with waitSeconds ${WAIT_MAX_S} (repeat until it says FINALIZED) and show that update the same way.`;
      return { content: [{ type: "text", text: `${head}\n\n${report}` }, ...photos(m, pick)] };
    }),
  );

  server.registerTool(
    "end_rover_mission",
    {
      title: "End a rover mission",
      description: "End a hired rover mission early: no more moves are paid, the rover stops, and photos already delivered " +
                   "stay paid. Feedback for the rover follows: 100 x photos delivered / photos wanted. Call this ONLY when the user " +
                   "asks to stop the mission. Never end it because the rover pauses or seems stalled: it holds still and asks its AI " +
                   "again, which can take a minute or two, and a pause costs nothing because moves are paid only as the rover uses them.",
      inputSchema: { missionId: z.string().optional().describe("From hire_rover; defaults to the latest mission") },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ missionId }) => guard(async () => {
      const m = ownMission(missionId);
      if (!m) return fail("No such mission in this session.");
      if (m.phase === "finishing") return text(`Mission ${m.id} has already finished (${m.summary?.stop}); its feedback is being written now.`);
      if (m.phase !== "running") return text(`Mission ${m.id} is ${m.phase}; nothing to end.`);
      m.abort.abort();
      return text(`Ending mission ${m.id}: the rover stops within a second; feedback follows. Call rover_mission_status to see the result.`);
    }),
  );
}
// 2026-11-06T18:02:00
// 2026-11-06T22:52:36
