// The final mission report (P8): everything the user, a Hedera judge and a 0G judge need to check the mission end to
// end, as markdown with a link behind every claim. Photos (0G Storage download, HashScan payment, sha256), Hedera
// (ERC-8004, A2A negotiation, x402 payments, HCS logs, Agent Kit audit, feedback), 0G (Compute TEE proofs, Storage
// segments, EpisodeLog anchors), and how to verify it yourself.
import { CHAINS, chainOfTx, ERC8004, HASHSCAN, mirror, txIdToMirror, USDC, usdcString } from "@0xBs/hedera";
import { paidOn, type HireResult, type MissionSummary, type Negotiation, type Rover } from "@0xBs/hedera-buyer";
import { galileoExplorer, mainnetExplorer, replayUrl, zgIndexer, zgLogUrl } from "./config.js";

type Payment = MissionSummary["payments"][number];

/** What a safe stop means, in one wording everywhere: a reader who sees "0G?" thinks 0G failed, but most are answers a
 * mission rule refused. The rover does not move on a safe stop, so no TEE proof is needed for it. */
export function stopKind(r: { safe_stop: string | null; answered?: boolean }): string {
  return r.safe_stop === "!TEE" ? "TEE proof did not verify" : r.safe_stop === "402" ? "waiting for payment"
    : r.safe_stop === "BAT" ? "motor battery too low (mission ended)"
    : r.answered ? "answer refused by a mission rule" : "0G not reachable";
}

export interface MissionView {
  id: string;
  mission: string;
  photos: number;
  budget: bigint;
  rovers?: Rover[];
  negotiation?: Negotiation;
  payments: Payment[];
  summary?: MissionSummary;
  result?: HireResult;
  consensus: Map<string, string>; // Hedera tx id or EVM hash → consensus timestamp
}

const short = (h: string, n = 6) => (h && h.length > 2 * n + 3 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
const link = (label: string, url: string) => `[${label}](${url})`;
const topic = (id: string) => link(id, `${HASHSCAN}/topic/${id}`);
const galileoTx = (hash: string) => link(short(hash), `${galileoExplorer}/tx/${hash}`);
// The indexer serves the file as an attachment named after its root; `name` makes it photo_1.jpg instead.
const storage = (label: string, root: string, name: string) => link(label, `${zgIndexer}/file?root=${root}&name=${encodeURIComponent(name)}`);

async function getJson(url: string): Promise<any> {
  try {
    return await (await fetch(url, { signal: AbortSignal.timeout(5000) })).json();
  } catch {
    return null;
  }
}

/** HashScan opens a transaction by its consensus timestamp, which the mirror node gives for a tx id or an EVM hash. */
async function hashscanTx(m: MissionView, id: string): Promise<string> {
  if (!m.consensus.has(id)) {
    const d: any = id.startsWith("0x") ? await mirror(`/api/v1/contracts/results/${id}`).catch(() => null)
                                       : (await mirror(`/api/v1/transactions/${txIdToMirror(id)}`).catch(() => null))?.transactions?.[0];
    const ts = d?.consensus_timestamp ?? d?.timestamp;
    if (ts) m.consensus.set(id, ts);
  }
  const ts = m.consensus.get(id);
  return ts ? `${HASHSCAN}/transaction/${ts}` : `${HASHSCAN}/search-result?q=${encodeURIComponent(id)}`;
}

/** A payment's link on its own chain's explorer (the chain read from the transaction id's shape). */
async function payLink(m: MissionView, tx: string): Promise<{ url: string; explorer: string }> {
  const c = chainOfTx(tx) ?? CHAINS.hedera;
  return { url: c.chain === "hedera" ? await hashscanTx(m, tx) : c.txUrl(tx), explorer: c.explorer };
}

/** True once 0G has everything: the episode ended on chain and every paid photo has its own storage root. */
export async function zgComplete(m: MissionView): Promise<boolean> {
  const deal = m.negotiation?.deal;
  if (!deal) return true;
  const ep = (await getJson(`${zgLogUrl}/segments?episode_id=${deal.quote_id}`))?.[0];
  const paid = m.payments.filter((p) => p.kind === "photo" && p.ok).map((p) => String(p.n));
  return !!ep?.ended && paid.every((n) => ep.photos?.[n]?.root);
}

type Topics = { spend: string | null; audit: string | null };
type Facts = Awaited<ReturnType<typeof facts>>;

const usd = (a: string) => usdcString(a);
const price = (mv: string, ph: string) => `${usd(mv)} + ${usd(ph)}`;

const nothingHired = (m: MissionView) =>
  `# Mission ${m.id}: nothing hired\n\nNo seller offered the job within ${usdcString(m.budget)} USDC, so nothing was paid.\n\n` +
  (m.negotiation?.declined ?? []).map((d) => `- #${d.agentId}: ${d.reason}`).join("\n");

/** What both reports read: the deal and payments, zg-log's view of the episode, and every HashScan link resolved. */
async function facts(m: MissionView) {
  const deal = m.negotiation!.deal!;
  const res = m.result;
  const paid = m.payments.filter((p) => p.ok && p.tx);
  const moves = paid.filter((p) => p.kind === "move");
  const photosPaid = paid.filter((p) => p.kind === "photo");
  const [episodes, records, zgHealth, shop] = await Promise.all([
    getJson(`${zgLogUrl}/segments?episode_id=${deal.quote_id}`), getJson(`${zgLogUrl}/records?episode_id=${deal.quote_id}&last=500`),
    getJson(`${zgLogUrl}/health`), getJson(`${deal.shop}/health`)]);
  const recs: any[] = records?.last ?? [];
  const decisions = recs.filter((r) => r.skill);
  const f = res?.feedback;
  // Resolve every HashScan link at once (most were looked up as the payments happened).
  await Promise.all([...paid.map((p) => p.tx!), (res?.audit as any)?.transactionId, f?.tx, (f?.file as any)?.proofOfPayment?.txId]
    .filter((id) => id && chainOfTx(id) !== CHAINS.base && chainOfTx(id) !== CHAINS.solana).map((id) => hashscanTx(m, id)));
  return { deal, on: paidOn(deal), res, done: res?.mission ?? m.summary, rover: m.rovers?.find((r) => r.agentId === deal.agentId), paid, moves, photosPaid,
           spent: BigInt(deal.price_move) * BigInt(moves.length) + BigInt(deal.price_photo) * BigInt(photosPaid.length),
           ep: episodes?.[0], checkpoints: records?.records ?? recs.length, recs, decisions,
           verified: decisions.filter((r) => r.verified).length, first: recs.find((r) => r.signer) ?? {}, f, zgHealth, shop };
}

/** Title, the one-paragraph story, the at-a-glance table and the replay link. */
function opening(m: MissionView, x: Facts, opts: { feedbackPending?: boolean }): string[] {
  const { deal, on, done, rover, moves, photosPaid, spent, ep, f } = x;
  const anchored = (ep?.segments ?? []).filter((g: any) => g.anchor).length;
  return [
    `# 📦 ${m.mission.split(":")[0]} — ${done?.stop === "all photos delivered" ? "complete ✅" : done?.stop ?? "finished"}`, "",
    `> Claude hired **${deal.name}**${rover?.body === "arduino-uno-q" ? ", a real Arduino UNO Q rover," : ""} after finding it on ERC-8004 and ` +
    `negotiating over A2A. The rover paid its way in USDC on ${on.chain.label}, the chain you chose: every move before it drove, every photo on delivery. ` +
    `Every move was decided by an AI model running in a 0G TEE, and every decision is stored on 0G Storage and anchored on-chain.`, "",
    "## At a glance", "", "| | |", "|---|---|",
    `| 📷 **Photos** | ${photosPaid.some((p) => p.lost) ? `${photosPaid.length} of ${m.photos} paid; photo ${photosPaid.filter((p) => p.lost).map((p) => p.n).join(", ")} ` +
                     "reached the rover's record but its reply was lost on the way (download it from 0G Storage below)" : `${photosPaid.length} of ${m.photos} delivered`} |`,
    `| 💵 **Cost** | **${usd(spent.toString())} USDC** of a ${usd(m.budget.toString())} budget — ${moves.length} moves × ${usd(deal.price_move)} + ${photosPaid.length} photos × ${usd(deal.price_photo)} |`,
    `| ⏱️ **Time** | ${done?.seconds ?? "?"} s · ${x.checkpoints} checkpoints |`,
    `| 🔐 **AI decisions** | ${x.verified} of ${x.decisions.length} verified in a 0G TEE |`,
    `| 🧾 **Payments** | ${x.paid.length} x402 payments on ${on.chain.label}, all settled${on.chain.chain === "hedera" ? "" : "; each one also recorded on Hedera (HCS)"} |`,
    `| 🗄️ **0G record** | ${ep?.ended ? `${anchored} segments stored on 0G Storage, all anchored on-chain`
                                       : `${anchored} segments anchored on-chain so far — ⏳ the last ones within about a minute`} |`,
    ...(f ? [`| ⭐ **Rating** | ${deal.name} now ${f.summary.value}/100 from ${f.summary.count} review${f.summary.count === 1 ? "" : "s"} |`]
        : opts.feedbackPending ? ["| ⭐ **Rating** | ⏳ being recorded on ERC-8004 |"] : []),
    "", replayLine(deal.quote_id), "",
  ];
}

const replayLine = (episode: string) => `**🔎 Check it all yourself:** ${link("replay and verify ↗", `${replayUrl}/?episode=${episode}`)} — your ` +
  "browser re-checks every 0G root, TEE signature and payment from public records, with no server of ours in between.";

/** The report: every payment, segment and request id, and the replay link. Items still settling are marked ⏳ and
 * filled in later. */
export async function finalReport(m: MissionView, topics: Topics, opts: { feedbackPending?: boolean } = {}): Promise<string> {
  const n = m.negotiation;
  if (!n?.deal) return nothingHired(m);
  const x = await facts(m);
  const { deal, on, res, photosPaid, paid, ep, recs, decisions, verified, first, f, zgHealth, shop } = x;
  const explorer = on.chain.explorer;
  const rover = x.rover;
  const stops = recs.filter((r) => r.safe_stop).reduce((a: Record<string, number>, r) => ({ ...a, [stopKind(r)]: (a[stopKind(r)] ?? 0) + 1 }), {});
  const counter = (a: string) => ((BigInt(a) * 75n) / 100n).toString();
  const L = opening(m, x, opts);

  L.push("## 📷 Photos", "", "The photos are attached below. **⬇️ downloads the photo itself from 0G Storage**; its fingerprint matches the one " +
         `in the rover's anchored record. The ${explorer} column is the payment for that photo.`, "");
  L.push(`| Photo | View / download (0G Storage) | Paid (${explorer}) | Fingerprint (sha256) | Decided at |`, "|---|---|---|---|---|");
  for (const p of photosPaid) {
    const onZg = ep?.photos?.[String(p.n)];
    const rec = recs.find((r) => r.photo === p.n);
    L.push(`| **${p.n}** | ${onZg?.root ? storage(`⬇️ photo_${p.n}.jpg`, onZg.root, `photo_${p.n}.jpg`) : "⏳ uploading to 0G"} | ${link(`${usd(deal.price_photo)} USDC ↗`, (await payLink(m, p.tx!)).url)} | ` +
           `${p.photo_sha256 ? `\`${short(p.photo_sha256, 8)}\`` : "reply lost: compare with the rover's record"} | ${rec ? `checkpoint ${rec.seq}` : ""} |`);
  }
  L.push("");

  const onHedera = on.chain.chain === "hedera";
  let sec = 0;
  const h3 = (title: string) => `### ${++sec} · ${title}`;
  L.push("## 🟣 Hedera proofs", "");
  if (!onHedera) L.push(`The money moved on ${on.chain.label} (below). Everything else about the deal happened on Hedera: who was hired, the agreed price, ` +
                        `a public log of every payment with its ${on.chain.label} transaction, and the review.`, "");
  L.push(h3("Who was hired — ERC-8004 identity"), "");
  L.push("| Agent | Kind | Payment account (= registered agentWallet) | List price (move + photo) | Rating when hired |", "|---|---|---|---|---|");
  // the registry is public: other teams' agents (no rover card) are counted, not listed
  const others = (m.rovers ?? []).filter((v) => v.agentId !== deal.agentId);
  const skipped = others.filter((v) => !v.valid).length;
  for (const r of [rover, ...others.filter((v) => v.valid)].filter(Boolean) as Rover[])
    L.push(`| #${r.agentId} **${r.name}**${r.agentId === deal.agentId ? " ✅ hired" : ""} | ${r.body === "arduino-uno-q" ? "real rover" : r.body} | ` +
           `${link(r.payTo, `${HASHSCAN}/account/${r.payTo}`)} | ${price(r.list.move, r.list.photo)} | ${r.rating.count ? `${r.rating.value}/100 (${r.rating.count})` : "—"} |`);
  L.push("", `Found from on-chain events alone in the ERC-8004 ${link("IdentityRegistry ↗", `${HASHSCAN}/contract/${ERC8004.identity}`)}.` +
         (skipped ? ` ${skipped} other agent${skipped === 1 ? "" : "s"} on the shared registry ${skipped === 1 ? "is" : "are"} not a rover for hire (no valid rover agent card) and ${skipped === 1 ? "was" : "were"} skipped.` : "") +
         (on.chain.chain === "hedera" ? "" : ` ${deal.name} was paid on ${on.chain.label} at ${link(on.payTo, on.chain.accountUrl(on.payTo))}, the address its ERC-8004 card and its storefront both name.`), "");

  L.push(h3("Negotiation — A2A"), "");
  L.push("| Seller | Asked | Our counter (75 %) | Their answer | Expected total | Outcome |", "|---|---|---|---|---|---|");
  for (const o of n!.offers) {
    const d = n!.declined.find((x) => x.agentId === o.agentId);
    L.push(`| ${o.name} | ${price(o.list.move, o.list.photo)} | ${price(counter(o.list.move), counter(o.list.photo))} | ` +
           `${o.error ? `no offer (${o.error})` : `${price(o.price_move!, o.price_photo!)}${o.meetsOffer ? " — met our counter" : o.final ? " — final" : ""}`} | ` +
           `${o.expected ? `${usd(o.expected)} USDC` : "—"} | ${o.agentId === deal.agentId ? "✅ hired" : `❌ ${d?.reason ?? "declined"}`} |`);
  }
  const auditTx = (res?.audit as any)?.transactionId;
  L.push("", `Expected total = move price × ${n!.summary.est_moves} moves (estimated from real missions) + photo price × ${m.photos} photos.` +
         (auditTx ? ` The negotiation transcript's fingerprint \`${short(n!.transcript_sha256, 8)}\` is on the audit topic: ${link("HashScan ↗", await hashscanTx(m, auditTx))}.` : ""), "");

  // The payments: inside the Hedera proofs when Hedera paid, in their own section after them when Base or Solana paid.
  const P: string[] = [];
  const usdcLink = on.chain.chain === "hedera" ? `${HASHSCAN}/token/${USDC}` : on.chain.accountUrl(on.chain.usdc);
  P.push(`${paid.length} payments in ${link("USDC", usdcLink)} on ${on.chain.label} to ${link(on.payTo, on.chain.accountUrl(on.payTo))}; ` +
         `network fees paid by the facilitator${on.chain.chain === "hedera" && shop?.facilitator ? ` (${shop.facilitator})` : ""}. A move is paid before the wheels turn; a photo only once it is delivered.` +
         (onHedera ? "" : ` Each payment is also on ${deal.name}'s money log on Hedera (above, under Hedera proofs), with its ${on.chain.label} transaction.`), "");
  P.push("| # | For | USDC | Transaction |", "|---|---|---|---|");
  let i = 0;
  for (const p of m.payments) {
    i++;
    const what = (p.kind === "photo" ? `📷 photo ${p.n}` : "move") + (p.ok && p.lost ? " (reply lost on the way; confirmed on the ledger)" : "");
    const price = usd(p.kind === "move" ? deal.price_move : deal.price_photo);
    if (p.ok && p.tx) { const l = await payLink(m, p.tx); P.push(`| ${i} | ${what} | ${price} | ${link(`${l.explorer} ↗`, l.url)} |`); }
    else if (p.tx) { const l = await payLink(m, p.tx); P.push(`| ${i} | ${what} | ${price} | ${link(`${l.explorer} ↗`, l.url)}: the money moved, but the seller answered HTTP ${p.status} and did not count it |`); }
    else P.push(`| ${i} | ${what} | — | not paid (${p.refused ?? `HTTP ${p.status}${p.error ? `: ${p.error}` : ""}`}); no money moved |`);
  }
  P.push("");
  if (onHedera) L.push(h3("Payments — x402, USDC"), "", ...P);

  L.push(h3("Audit trail — Hedera Consensus Service"), "");
  L.push("| Log | Topic | What it holds |", "|---|---|---|");
  const which = onHedera ? "" : `, each with its ${on.chain.label} transaction`;
  if (topics.spend) L.push(`| Buyer spending log | ${topic(topics.spend)} | every payment decision the buyer made${which} |`);
  if (shop?.money_topic) L.push(`| Rover money log | ${topic(shop.money_topic)} | every payment the rover received${which} |`);
  if (topics.audit) L.push(`| Agent Kit audit trail | ${topic(topics.audit)} | each payment made through the Agent Kit tool \`pay_x402_request\` |`);
  L.push("", `Spending rules checked before every signature: at most 0.20 USDC per payment, only the quoted payment account and the exact agreed price, ` +
         `mission budget ${usd(m.budget.toString())} USDC. Raw HBAR or token transfers are blocked by Agent Kit policy.`, "");

  L.push(h3("Reputation — ERC-8004"), "");
  if (f) {
    L.push("| Score given | Transaction | Proof of payment | Rating now |", "|---|---|---|---|");
    L.push(`| ${f.score}/100 for #${deal.agentId} | ${f.tx ? link("HashScan ↗", await hashscanTx(m, f.tx)) : "on chain (the relay did not return its tx)"} | ` +
           `${link("last photo payment ↗", (await payLink(m, (f.file as any).proofOfPayment?.txId ?? "")).url)} | ${f.summary.value}/100 from ${f.summary.count} review${f.summary.count === 1 ? "" : "s"} |`);
  } else L.push(res?.feedbackError ? `Feedback was not recorded: ${res.feedbackError}`
                : opts.feedbackPending ? "⏳ Rover-A's rating is being recorded on ERC-8004 (about 10 s); it follows in the update."
                : "No feedback: no photo was delivered.");
  L.push("");

  if (!onHedera) L.push(`## 💵 Payments on ${on.chain.label} — x402, USDC`, "", ...P);

  L.push("## 🟢 0G proofs", "");
  L.push("### 1 · AI decisions — 0G Compute in a TEE", "");
  L.push("| | |", "|---|---|");
  L.push(`| Model | \`${first.model ?? "?"}\` (private, TeeML) |`);
  L.push(`| Provider | ${link(short(first.provider ?? ""), `${mainnetExplorer}/address/${first.provider}`)} on 0G mainnet |`);
  L.push(`| TEE signer | \`${first.signer ?? "?"}\`, read on-chain from the provider's service |`);
  L.push(`| Decisions | **${decisions.length}, ${verified} signature-verified** — each signature recovers to the TEE signer |`);
  if (Object.keys(stops).length)
    L.push(`| Safe stops | ${Object.entries(stops).map(([k, v]) => `${v} × ${k}`).join(", ")} — the rover held still and asked again |`);
  L.push("", "| Photo | Checkpoint | 0G request id | TEE proof |", "|---|---|---|---|");
  for (const p of photosPaid) {
    const rec = recs.find((r) => r.photo === p.n);
    if (rec) L.push(`| ${p.n} | ${rec.seq} | \`${rec.request_id}\` | ${rec.verified ? "✅ verified" : "❌ not verified"} |`);
  }
  L.push("");
  if (ep) {
    L.push("### 2 · Storage — 0G Storage, anchored on-chain", "");
    L.push("Every checkpoint (decision, proof, sensors, payment, camera frame) is hash-chained, uploaded to 0G Storage once a minute, " +
           `and its root anchored in the EpisodeLog contract${zgHealth?.contract ? ` ${link(short(zgHealth.contract), `${galileoExplorer}/address/${zgHealth.contract}`)}` : ""}.`, "");
    L.push("| Segment | Checkpoints | Download (0G Storage) | Anchored (0G chain) |", "|---|---|---|---|");
    for (const s of ep.segments ?? [])
      L.push(`| ${s.index} | ${s.first_seq}–${s.last_seq} | ${s.root ? storage(`⬇️ ${short(s.root)}`, s.root, `${deal.quote_id}_segment_${s.index}.json`) : "⏳ uploading"} | ${s.anchor?.tx ? galileoTx(s.anchor.tx) : "⏳ anchoring"} |`);
    L.push("", `| Episode \`${deal.quote_id}\` | |`, "|---|---|");
    L.push(`| Started | ${ep.started?.tx ? galileoTx(ep.started.tx) : "pending"} |`);
    L.push(`| Ended | ${ep.ended?.tx ? galileoTx(ep.ended.tx) : "⏳ closing on-chain after the last uploads"} |`, "");
    if (!ep.ended) L.push("Segments still uploading hold the last checkpoints; the episode is closed on-chain once they are anchored.", "");
  }
  L.push("## 🔎 Verify it yourself", "");
  L.push(`1. **Everything at once:** ${link("replay and verify ↗", `${replayUrl}/?episode=${deal.quote_id}`)} — your browser re-checks ` +
         `every segment's 0G root, every TEE signature and every payment on ${on.chain.label}, and lets you step through what the rover saw.`);
  L.push(`2. **Payments:** open any ${explorer} link — payer, receiver and the USDC amount.`);
  L.push("3. **Photos:** download one from 0G Storage and hash it — the sha256 matches the table above and the rover's record.");
  L.push("4. **AI decisions:** download a segment — its records are hash-chained, and each decision's TEE signature recovers to the signer above.");
  L.push(`5. **From the repo:** \`node services/zg-log/scripts/verify-episode.ts ${deal.quote_id}\` checks the episode against the chain.`);
  return L.join("\n");
}

/** The follow-up once everything has settled: the whole report again with nothing marked ⏳. Only the settled tables
 * left the first report's "⏳ the last ones within about a minute" standing above "all proofs are final" when Claude
 * merged the two into one answer (a live run). */
export function finalizedUpdate(report: string): string {
  return ["> 🔒 **All proofs are final.** Everything that was still settling when the mission ended is now on-chain: the photos " +
          "on 0G Storage, every segment anchored, the episode closed, and the rover's rating recorded.", "", report].join("\n");
}
