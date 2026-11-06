"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArchPage } from "@/components/arch";
import { Pixel } from "@/components/pixel";
import { REMOTE_RUN } from "@/lib/config";
import type { PixelName } from "@/lib/pixels";

const MCP_URL = "https://rover-for-hire.onrender.com/mcp/";
const HEALTH = "https://rover-for-hire.onrender.com/health";
const HEALTH_SAME_SITE = "/rover-status"; // public/vercel.json forwards it to HEALTH, so strict browsers (Brave) don't block it

/** Whether remote hiring is switched on right now, read from the remote MCP server every 30 s. */
function Online() {
  const [state, setState] = useState<"checking" | "on" | "off" | "unknown">("checking");
  useEffect(() => {
    const read = (url: string) => fetch(`${url}?t=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }) as Promise<{ remote_access?: boolean }>;
    const check = () => read(HEALTH_SAME_SITE).catch(() => read(HEALTH))
      .then((d) => setState(d.remote_access ? "on" : "off")).catch(() => setState("unknown"));
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);
  const text = {
    checking: "Checking whether the rover can be hired right now…",
    on: "The rover can be hired right now",
    off: "Remote hiring is switched off right now. We turn it on for demos.",
    unknown: "The rover's server can't be reached right now",
  }[state];
  return (
    <p className={`mt-8 inline-flex items-center gap-3 border px-4 py-3 font-label text-xs uppercase tracking-[0.14em] ${state === "on" ? "border-accent text-accent" : "border-night-rule text-chalk-2"}`}>
      <span className={`h-3 w-3 ${state === "on" ? "animate-pulse bg-accent" : "bg-night-rule"}`} aria-hidden />{text}
    </p>
  );
}

function Block({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-night-rule py-10">
      <p className="font-label text-xs uppercase tracking-[0.3em] text-chalk-2">{label}</p>
      <h2 className="mt-3 font-pixel text-3xl leading-tight sm:text-4xl">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Point({ icon, title, children }: { icon: PixelName; title: string; children: ReactNode }) {
  return (
    <li className="group flex gap-4 bg-night p-5">
      <Pixel name={icon} size={36} className="shrink-0 text-chalk" />
      <div>
        <p className="font-pixel text-xl leading-tight">{title}</p>
        <p className="mt-2 leading-relaxed text-chalk-2">{children}</p>
      </div>
    </li>
  );
}

export function Hire() {
  return (
    <ArchPage>
      <header className="pb-8">
        <nav className="flex flex-wrap items-center justify-between gap-4 py-4 font-label text-xs uppercase tracking-widest text-chalk-2">
          <Link href="/" className="hover:text-accent">‹ Rover for Hire</Link>
          <Link href="/live/" className="hover:text-accent">Live ›</Link>
        </nav>
        <p className="pt-6 font-pixel text-5xl leading-none sm:text-7xl">ROVER<span className="text-accent">/</span>HIRE</p>
        <p className="mt-4 font-label text-sm uppercase tracking-[0.3em] text-chalk-2">Hire it from your own AI</p>
        <p className="mt-8 max-w-3xl text-lg leading-relaxed">
          The rover&apos;s tools speak MCP, so any AI app that supports MCP can hire it, not only the owner&apos;s Claude Desktop.
          Ask your AI for an inspection, and it finds the rover on Hedera, agrees a price, and pays for every move and photo as it happens, in USDC on
          Hedera, Base or Solana. It asks you which chain every time.
        </p>
        <Online />
      </header>

      <Block label="Two ways in" title="Connect your AI">
        <div className="grid gap-px bg-night-rule sm:grid-cols-2">
          <div className="bg-night p-6">
            <p className="font-label text-xs uppercase tracking-[0.2em] text-chalk-2">On the owner&apos;s laptop</p>
            <p className="mt-3 leading-relaxed">Claude Desktop runs our MCP server locally, next to the rover&apos;s shop. This is how the rover is run at the booth.</p>
          </div>
          <div className="bg-night p-6">
            <p className="font-label text-xs uppercase tracking-[0.2em] text-accent">From anywhere</p>
            <p className="mt-3 leading-relaxed">Add the remote MCP server as a custom connector, with your own key at the end:</p>
            <p className="mt-3 break-all border border-night-rule px-3 py-2 font-mono text-sm">{MCP_URL}<span className="text-accent">&lt;your key&gt;</span></p>
            <ul className="mt-4 space-y-2 leading-relaxed text-chalk-2">
              <li><span className="text-chalk">Claude:</span> Settings → Connectors → Add custom connector.</li>
              <li><span className="text-chalk">ChatGPT:</span> turn on Developer mode, create a connector, choose No authentication. The key is already in the address.</li>
            </ul>
            <p className="mt-4 leading-relaxed text-chalk-2">Each user needs a key. Ask us for one; judges get one.</p>
          </div>
        </div>
        <p className="mt-6 max-w-3xl leading-relaxed">
          Then just ask: <span className="font-mono text-accent">&quot;Hire a rover to inspect parcel #1, 3 photos, budget 0.60 USDC&quot;</span>.
          Each photo arrives in your chat as soon as it is paid for.
        </p>
      </Block>

      <Block label="Strangers can hire it" title="How it stays safe">
        <ul className="grid gap-px bg-night-rule md:grid-cols-2">
          <Point icon="rover" title="Only the MCP server is in the cloud">
            The rover&apos;s shop, the 0G logger and the rover itself stay together on the booth&apos;s Wi-Fi. The heartbeat that keeps a paid move alive never crosses the internet.
          </Point>
          <Point icon="shield" title="A filter in front of the shop">
            The cloud reaches the shop through a tunnel. Only the shop&apos;s public routes get through, starting or ending a mission needs a secret key, and everything else gets &quot;not found&quot;.
          </Point>
          <Point icon="coin" title="Its own wallets, with caps">
            Remote missions pay from their own wallets on Hedera, Base and Solana, never the owner&apos;s. One mission spends at most 1 USDC, all remote users together at most 2 USDC a day, and unused budget is freed when a mission ends.
          </Point>
          <Point icon="flag" title="One switch for the owner">
            A button on the laptop turns remote hiring on or off. When it is off, or the laptop is gone, remote users see the rover as offline within about 3 minutes.
          </Point>
          <Point icon="eye" title="Your missions, one at a time">
            Each user sees only their own missions. The rover takes one mission at a time, and a second hire gets &quot;rover busy&quot; before anything is paid.
          </Point>
          <Point icon="lock" title="No pay, no brain, no proof, no move">
            The same three rules hold for remote missions: every move is paid first (on the chain you chose), decided by an AI model on 0G, and signed in a TEE before the wheels turn.
          </Point>
        </ul>
      </Block>

      <Block label="Also for hire" title="Station-A, the sensor station">
        <div className="flex flex-wrap gap-6">
          <Pixel name="station" size={56} className="shrink-0 text-chalk" />
          <div className="max-w-3xl">
            <p className="leading-relaxed">
              A second Arduino UNO Q sells signed readings of the room: temperature, humidity, light and motion, 0.001 USDC each, paid with x402 in USDC on Hedera, Base or Solana.
              Three tools find and buy them: <span className="font-mono text-chalk">find_sensors</span>, <span className="font-mono text-chalk">buy_sensor_reading</span> and{" "}
              <span className="font-mono text-chalk">buy_sensor_history</span>.
            </p>
            <p className="mt-4 leading-relaxed text-chalk-2">
              They are on the remote server too, with the same key. Ask:{" "}
              <span className="font-mono text-chalk">&quot;What&apos;s the temperature and humidity at the booth? Buy one reading from Station-A, pay with Solana.&quot;</span>
            </p>
            <p className="mt-6">
              <Link href="/station/" className="inline-flex items-center gap-2.5 border border-accent px-4 py-3 font-label text-xs uppercase tracking-[0.14em] text-accent hover:bg-accent hover:text-night">
                See Station-A&apos;s sales ›
              </Link>
            </p>
          </div>
        </div>
      </Block>

      {REMOTE_RUN && <Block label="Tested with the real rover" title="It already works">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          {REMOTE_RUN.facts.map(([v, l]) => (
            <p key={l} className="flex items-baseline gap-2"><span className="font-dots text-4xl text-accent">{v}</span><span className="font-label text-xs uppercase tracking-[0.2em] text-chalk-2">{l}</span></p>
          ))}
        </div>
        <p className="mt-6 max-w-3xl leading-relaxed">
          Remote missions came in from ChatGPT, through the cloud server, to the real rover. We also checked that it survives a 25-second network cut,
          the cloud server restarting mid-mission, a slow network and a laptop reboot.
        </p>
        <p className="mt-6">
          <Link href={`/?episode=${REMOTE_RUN.id}`} className="inline-flex items-center gap-2.5 border border-accent px-4 py-3 font-label text-xs uppercase tracking-[0.14em] text-accent hover:bg-accent hover:text-night">
            Replay that remote mission ›
          </Link>
        </p>
      </Block>}
    </ArchPage>
  );
}
