import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { ArchSlide, Poster } from "@/components/arch";
import { Bubble, Card, CHAIN_INK, Chip, Face, Need, Points, Row, Slide } from "@/components/pitch";
import { Pixel } from "@/components/pixel";
import { HEDERA, MULTICHAIN, STATION as STATION_BOARD, SYSTEM, ZEROG } from "@/lib/arch";
import { DEFAULT_LOG, LAST_RUN, REPO, ROVER_A, ROVER_B, SITE, STATION, TOPICS, type Run } from "@/lib/config";

export const metadata: Metadata = { title: "Rover for Hire · Pitch" };

// The ETHGlobal pitch: 1920×1080 pages for print to PDF. The finalist session is 4 minutes of demo and 3 of Q&A, so the
// first pages carry the pitch and the live demo, then the architecture, then the pages for the judges' usual questions
// (challenges, tools), the ids, and the other boards as an appendix.
const host = (u: string) => u.replace(/^https:\/\//, "");
const mono = (s: string) => <span className="font-mono text-chalk">{s}</span>;

type Page = { kicker: string; render: (n: number, total: number) => ReactNode };

/** The latest real mission's numbers (LAST_RUN), once there is one at the event. */
const results = (run: Run): Page => ({ kicker: "Results", render: (n, t) => (
  <Slide n={n} total={t} kicker="Results" title={`Mission ${run.id}`} sub={run.date}>
    <div className="grid flex-1 grid-cols-4 content-center gap-10">
      {run.facts.map(([v, l]) => (
        <div key={l}><p className="font-dots text-[6rem] leading-none text-chalk">{v}</p><p className="mt-4 font-label text-sm uppercase tracking-[0.25em] text-chalk-2">{l}</p></div>
      ))}
    </div>
  </Slide>
) });

const pages: Page[] = [
  { kicker: "", render: () => <Poster /> },

  { kicker: "Why", render: (n, t) => (
    <Slide n={n} total={t} kicker="Why" title={<>Claude can think.<br />It can&apos;t move.</>}
      sub="AI agents can already pay for APIs. We let one rent a body: a real rover, paid per move, with every move proven.">
      <div className="flex flex-1 items-center justify-between gap-16">
        <Points items={[
          "An AI agent hires a real Arduino UNO Q rover to inspect a parcel.",
          "It pays every move in USDC with x402, before the wheels turn.",
          "An AI model on 0G picks every move inside sealed hardware, and signs it.",
          "Every step is saved where anyone can check it.",
        ]} />
        <Pixel name="rover" size={300} grid={false} className="shrink-0 text-chalk" />
      </div>
    </Slide>
  ) },

  { kicker: "The rules", render: (n, t) => (
    <Slide n={n} total={t} kicker="The rules" title="Three rules for every move">
      <div className="grid flex-1 grid-cols-3 gap-8">
        {([["coin", "No pay, no move", "402", "Each move is paid in USDC before the wheels turn."],
           ["lock", "No brain, no move", "0G?", "An AI model on 0G picks the move. The rover never makes one up."],
           ["shield", "No proof, no move", "!TEE", "The answer is signed inside 0G's TEE. The rover checks the signature first."]] as const)
          .map(([icon, rule, face, text]) => (
            <Card key={rule} icon={icon} label="rule" title={rule}
              foot={<><p className="mb-5 font-label text-sm uppercase tracking-[0.25em] text-chalk-2">If it fails, the face shows</p><Face text={face} big /></>}>
              {text}
            </Card>
          ))}
      </div>
      <p className="mt-8 font-mono text-[1.6rem] text-chalk-2">If any rule fails, the wheels stay still and the rover&apos;s LED face says why.</p>
    </Slide>
  ) },

  { kicker: "The mission", render: (n, t) => (
    <Slide n={n} total={t} kicker="The mission" title="One sentence, then it runs by itself">
      <div className="grid flex-1 grid-cols-4 gap-6">
        {([["eye", "ERC-8004", "Find", "Claude's buyer agent finds the rovers listed on Hedera and checks each card."],
           ["card", "A2A", "Haggle", "It counters at 75 % of the list price. Rover-A takes 0.015 USDC a move and 0.06 a photo."],
           ["move", "0G + x402", "Drive", "Every move: a camera frame to 0G, a signed answer back, a paid move, then the wheels turn."],
           ["camera", "photos + review", "Deliver", "A photo is paid only when it reaches the chat. Then Claude reviews the rover on ERC-8004."]] as const)
          .map(([icon, label, title, text], i) => (
            <Card key={title} icon={icon} label={label} title={title} foot={<p className="font-dots text-[7rem] leading-none text-accent">{i + 1}</p>}>{text}</Card>
          ))}
      </div>
    </Slide>
  ) },

  { kicker: "Live demo", render: (n, t) => (
    <Slide n={n} total={t} kicker="Live demo" title="Watch it happen">
      <div className="grid flex-1 grid-cols-[1fr_1fr] gap-20">
        <div className="flex flex-col gap-6">
          <Bubble who="you">Hire a rover to inspect parcel #3. 5 photos. Budget 0.80 USDC.</Bubble>
          <Bubble who="ai">Pay with Hedera, Base or Solana?</Bubble>
          <Bubble who="you">Hedera.</Bubble>
        </div>
        <div>
          <p className="mb-8 font-label text-sm uppercase tracking-[0.3em] text-chalk-2">What to watch</p>
          <Points size="text-[1.7rem]" items={[
            "The rover: it looks around, finds box #3 among look-alikes, and circles it.",
            "The HUD: the brain, proof and money lights turn on before every move.",
            "The chat: each photo arrives a few seconds after it is taken.",
            <>The replay site: the whole mission re-checked in your browser, at {mono(host(SITE))}.</>,
          ]} />
        </div>
      </div>
    </Slide>
  ) },

  { kicker: "", render: () => <ArchSlide spec={SYSTEM} subject="Architecture · the whole system" logos={["hedera", "0g"]} /> },

  { kicker: "0G · Physical AI", render: (n, t) => (
    <Slide n={n} total={t} kicker="0G · Physical AI" title="0G is the brain, not the spinal cord"
      sub="Motion stays on the rover. 0G makes every decision and keeps the record.">
      <div>
        <Need need="A 0G call in the decision loop" have={<>Every move: one camera frame to {mono("0gm-1.0-35b-a3b")} in a TEE (TeeML, private mode), one signed move back.</>} />
        <Need need="A log on 0G Storage, a request id per decision" have={<>Hash-chained step records go to 0G Storage every 60 s. Each root is anchored in EpisodeLog on Galileo, {mono(`${DEFAULT_LOG.slice(0, 10)}…${DEFAULT_LOG.slice(-4)}`)}.</>} />
        <Need need="Live hardware, or a replay" have="Both: the rover at the booth, and the replay site that re-checks every step from public data." />
        <Need need="A safe stop when 0G is unreachable" have={<>The rover holds still and shows <span className="text-accent">0G?</span>. At the event, 0G&apos;s provider went down mid-mission: the rover stayed still for two minutes and nothing more was paid.</>} />
      </div>
    </Slide>
  ) },

  { kicker: "Hedera · x402", render: (n, t) => (
    <Slide n={n} total={t} kicker="Hedera · x402" title="Agents that pay, on Hedera" center>
      <div className="grid grid-cols-[1.25fr_1fr] gap-16">
        <Points size="text-[1.65rem]" items={[
          "Rover-A's shop is x402 on every move (settled before it moves) and every photo (settled on delivery).",
          "The buyer agent finds, haggles and pays by itself, with no human approving.",
          "Hard limits: 0.20 USDC a payment, the mission budget, only the quoted payTo and price.",
          <>Every payment is logged on HCS: the rover&apos;s money topic {mono(TOPICS.money)} and the buyer&apos;s spending topic {mono(TOPICS.spend)}.</>,
        ]} />
        <div>
          <p className="mb-6 font-label text-sm uppercase tracking-[0.3em] text-chalk-2">Also used</p>
          <div className="flex flex-wrap gap-4">
            {["Spending controls", `ERC-8004 identity #${ROVER_A.agentId}`, "ERC-8004 reviews", "HCS audit logs", "A2A haggling", "HTS USDC", "Hedera Agent Kit"]
              .map((c) => <Chip key={c}>{c}</Chip>)}
          </div>
          <p className="mt-10 font-mono text-[1.45rem] leading-snug text-chalk-2">Settled by Blocky402, with x402.org as the backup. The facilitator pays the HBAR fee, so the agent only spends USDC.</p>
        </div>
      </div>
    </Slide>
  ) },

  { kicker: "", render: () => <ArchSlide spec={MULTICHAIN} subject="Pay on any chain · Hedera · Base · Solana" logos={["hedera", "0g"]} /> },

  { kicker: "A market", render: (n, t) => (
    <Slide n={n} total={t} kicker="A market" title="Not one robot: a market for bodies" center>
      <div className="grid grid-cols-2 gap-10">
        <Card icon="station" label={`Station-A · ERC-8004 #${STATION.agentId}`} title="A second body sells data">
          <Points size="text-[1.6rem]" items={[
            "A second UNO Q sells signed readings: temperature, humidity, light, motion.",
            `${STATION.prices.reading} USDC a reading, on Hedera, Base or Solana, paid only on delivery.`,
            "Signed on the board. The buyer checks every signature before it pays.",
            <>Every sale on its own HCS topic, {mono(STATION.topic)}.</>,
          ]} />
        </Card>
        <Card icon="flag" label="remote MCP server" title="Hire it from your own AI">
          <Points size="text-[1.6rem]" items={[
            "Claude, ChatGPT or any MCP app can hire the rover from anywhere.",
            "Your AI asks you which chain pays, every time. It never picks for you.",
            "Remote users pay from their own wallets: at most 1 USDC a mission, 2 USDC a day.",
            "The shop stays on the booth Wi-Fi behind a filter, and the owner has an off switch.",
          ]} />
        </Card>
      </div>
    </Slide>
  ) },

  { kicker: "Verify", render: (n, t) => (
    <Slide n={n} total={t} kicker="Verify" title={<>Don&apos;t trust us.<br />Check it.</>}>
      <div className="grid flex-1 grid-cols-[1fr_1.1fr] items-center gap-16">
        <div>
          <p className="font-pixel text-[3.4rem] leading-tight text-accent">{host(SITE)}</p>
          <p className="mt-6 font-mono text-[1.6rem] leading-snug text-chalk-2">A static site. No server of ours sits in between: your browser reads 0G, Hedera, Base and Solana directly.</p>
        </div>
        <Points size="text-[1.65rem]" items={[
          "Every 0G Storage root is recomputed in your browser.",
          "Every TEE signature is checked against 0G's on-chain signer.",
          "Every move was paid before the rover acted, on the chain that paid.",
          "Every step links to the one before: change one byte, and that step fails.",
        ]} />
      </div>
    </Slide>
  ) },

  ...(LAST_RUN ? [results(LAST_RUN)] : []),

  { kicker: "Q&A · challenges", render: (n, t) => (
    <Slide n={n} total={t} kicker="Q&A · challenges" title="Hard parts we solved" center>
      <div>
        <Row head="Proof without the flag">Sealed TEE mode hides 0G&apos;s own “verified” flag. So the rover checks every signature itself, against the signer it reads live from 0G&apos;s chain.</Row>
        <Row head="Pay first, never stall">Three moves are always paid ahead, and the money lease lapses one second after the shop stops vouching for it.</Row>
        <Row head="One payment, one thing">Every payment is fingerprinted, and a second use is refused. A lost reply is checked on the chain itself before paying again.</Row>
        <Row head="Look-alike boxes">Before every photo, 0G reads the box&apos;s number blind. Wrong number: no photo, no charge.</Row>
      </div>
    </Slide>
  ) },

  { kicker: "Q&A · tools", render: (n, t) => (
    <Slide n={n} total={t} kicker="Q&A · tools" title="What we used, and why">
      <div className="grid flex-1 grid-cols-2 gap-8">
        <Card label="0G Compute · 0G Storage · EpisodeLog" title="A brain with receipts" ink={CHAIN_INK["0g"]}>
          A vision model in a TEE signs every decision, and every step is stored and anchored, so anyone can re-check the mission.
        </Card>
        <Card label="x402 · USDC" title="Pay per move" ink="#ff6a13">
          Agents pay agents per request, settled before the move: no accounts, no invoices. On Hedera, Base or Solana.
        </Card>
        <Card label="Hedera: ERC-8004 · A2A · HCS · Agent Kit" title="Find, haggle, log" ink={CHAIN_INK.hedera}>
          Sellers listed and reviewed on-chain, prices agreed agent to agent, every payment on a public log, limits enforced by policy.
        </Card>
        <Card label="Arduino UNO Q · MCP" title="A real body, any AI" ink="#a39d90">
          Linux for the brain and a real-time microcontroller for the wheels, on one board. MCP lets any AI app hire it.
        </Card>
      </div>
    </Slide>
  ) },

  { kicker: "Everything is public", render: (n, t) => (
    <Slide n={n} total={t} kicker="Everything is public" title="The ids" center>
      <div className="grid grid-cols-2 content-start gap-x-16 gap-y-10 font-mono text-[1.7rem] leading-snug">
        {([
          ["Live demo", host(SITE)],
          ["Code", host(REPO)],
          ["EpisodeLog · 0G Galileo", DEFAULT_LOG],
          ["0G model · provider", "0gm-1.0-35b-a3b · TeeML · 0xf4FB8d2b…0079B250"],
          ["ERC-8004 agents · Hedera testnet", `Rover-A #${ROVER_A.agentId} · Rover-B #${ROVER_B.agentId} · Station-A #${STATION.agentId}`],
          ["Rover-A's payTo", `Hedera ${ROVER_A.account}`],
          ["HCS topics", `money ${TOPICS.money} · spending ${TOPICS.spend} · audit ${TOPICS.audit} · station ${STATION.topic}`],
          ["Rover-A on Base · Solana", `${ROVER_A.pay.base.slice(0, 10)}…${ROVER_A.pay.base.slice(-4)} · ${ROVER_A.pay.solana.slice(0, 6)}…${ROVER_A.pay.solana.slice(-4)}`],
        ] as const).map(([k, v]) => (
          <div key={k} className="border-t border-night-rule pt-4">
            <p className="font-label text-xs uppercase tracking-[0.25em] text-chalk-2">{k}</p>
            <p className="mt-2 break-all text-chalk">{v}</p>
          </div>
        ))}
      </div>
    </Slide>
  ) },

  { kicker: "", render: () => (
    <section className="flex h-[1080px] w-[1920px] flex-col items-center justify-center bg-night text-chalk"
      style={{ backgroundImage: "radial-gradient(rgba(242,237,227,0.09) 1px, transparent 1.6px)", backgroundSize: "14px 14px" }}>
      <p className="font-pixel text-[9rem] leading-none tracking-tight">ROVER<span className="text-accent">/</span>HIRE</p>
      <div className="mt-16 flex flex-col items-center gap-5 font-pixel text-[3.2rem] leading-tight">
        <p>No pay, no move.</p><p>No brain, no move.</p><p>No proof, no move.</p>
      </div>
      <p className="mt-16 font-mono text-[2.2rem] text-accent">{host(SITE)}</p>
      <p className="mt-8 font-label text-lg uppercase tracking-[0.4em] text-chalk-2">Built on Hedera × 0G · pay on <span style={{ color: CHAIN_INK.base }}>Base</span> · <span style={{ color: CHAIN_INK.solana }}>Solana</span></p>
    </section>
  ) },

  { kicker: "", render: () => <ArchSlide spec={HEDERA} subject="Appendix · on Hedera · ERC-8004 · A2A · x402 · HCS · Agent Kit" logos={["hedera"]} /> },
  { kicker: "", render: () => <ArchSlide spec={ZEROG} subject="Appendix · on 0G · Compute (TEE) · Storage · Galileo" logos={["0g"]} /> },
  { kicker: "", render: () => <ArchSlide spec={STATION_BOARD} subject="Appendix · Station-A · ERC-8004 · x402 · HCS" logos={["hedera"]} /> },
];

export default function Page() {
  return (
    <div className="bg-night">
      <style>{"@page { size: 1920px 1080px; margin: 0 } html, body { background: #0a0a0a; margin: 0 } section { break-after: page } section:last-child { break-after: auto }"}</style>
      {pages.map((p, i) => <Fragment key={i}>{p.render(i + 1, pages.length)}</Fragment>)}
    </div>
  );
}
