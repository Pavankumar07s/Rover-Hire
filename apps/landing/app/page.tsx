import Link from "next/link";
import Image from "next/image";
import { BaseMark } from "@/components/base-mark";
import { LandingNav } from "@/components/nav";
import { LandingHero } from "@/components/hero";
import { LandingProof } from "@/components/demo";
import { LandingLoop } from "@/components/loop";
import { LandingBento } from "@/components/bento";
import { LandingMcu } from "@/components/mcu";
import { CodeTabs } from "@/components/code-tabs";
import { ArrowRight, CheckIcon } from "@/components/icons";
import { routes, site } from "@/lib/site";

export default function Home() {
  return (
    <div className="relative min-h-dvh w-full overflow-x-hidden">
      <LandingNav
        login={routes.login}
        signup={routes.signup}
        docs={site.docs}
        x402={site.x402}
      />
      <LandingHero signup={routes.signup} docs={site.docs} tweet={site.tweet} />
      <LandingProof tweet={site.tweet} tx={site.tx} />
      <LandingLoop />
      <LandingBento signup={routes.signup} docs={site.docs} />
      <LandingMcu docs={site.docs} />

      <section className="px-5 pb-28 md:px-8">
        <div className="mx-auto grid max-w-[1400px] items-center gap-12 overflow-hidden rounded-[24px] border border-[var(--hairline)] bg-[var(--canvas-card)] lg:grid-cols-[0.9fr_1.1fr]">
          <div className="relative min-h-[280px] lg:min-h-[460px]">
            <Image
              src="/generated/telemetry-grid.jpg"
              alt="Field-deployed sensor mesh selling telemetry to agents as a metered commodity"
              fill
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent lg:hidden" />
          </div>
          <div className="px-8 py-10 lg:py-16 lg:pr-14">
            <p className="text-[13px] tracking-[0.16em] text-[var(--body-mid)] uppercase">
              Metered telemetry
            </p>
            <h2 className="mt-3 text-[clamp(28px,3.8vw,42px)] font-medium leading-[1.08] tracking-[-0.03em] text-white">
              Sensor data is a globally priced commodity.
            </h2>
            <p className="mt-5 text-[16px] leading-relaxed text-white/50">
              Soil probes, weather stations, energy meters, occupancy arrays —
              any reading becomes a paywalled primitive. Agents purchase a
              sample the same way they purchase a software API. Operators
              capture micropayment yield on every poll, from any jurisdiction
              an agent can reach the public internet.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-white/45">
              Hardware is no longer a local asset. It is inventory on a
              machine-to-agent market.
            </p>
          </div>
        </div>
      </section>

      <section id="protocol" className="scroll-mt-24 px-5 pb-28 md:px-8">
        <div className="mx-auto grid max-w-[1400px] items-start gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="text-[15px] text-[var(--body-mid)]">For integrators</p>
            <h2 className="mt-3 text-[clamp(36px,4.5vw,48px)] font-medium leading-[1.05] tracking-[-0.03em] text-white">
              One HTTP 402 contract.
              <br />
              <span className="text-white/40">Every MCU.</span>
            </h2>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-white/45">
              If an agent already pays software APIs over x402, it already
              knows how to pay a greenhouse probe or an L298N chassis. Firmware
              wraps the function. The agent never sees MQTT.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={routes.signup} className="landing-pill-fill px-5 py-3">
                Get API access
                <ArrowRight />
              </a>
              <a href={site.docs} className="landing-pill px-5 py-3">
                Protocol docs
              </a>
            </div>
            <div className="mt-10 grid max-w-lg grid-cols-3 gap-6">
              {[
                { k: "$3", v: "MCU BOM as a merchant" },
                { k: "0", v: "on-device wallet or PCI" },
                { k: "$0.001", v: "finest USDC settlement" },
              ].map((s) => (
                <div key={s.v}>
                  <div className="text-[22px] tracking-tight text-white">{s.k}</div>
                  <p className="mt-1 text-[13px] leading-snug text-[var(--body-mid)]">
                    {s.v}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <CodeTabs api={site.api} />
        </div>
      </section>

      <section className="landing-grid border-y border-[var(--hairline)] px-5 py-28 md:px-8">
        <div className="mx-auto grid max-w-[1400px] gap-16 text-center md:grid-cols-3">
          {[
            { k: "wrap()", v: "Existing GPIO becomes a priced service" },
            { k: "x402", v: "Open HTTP 402 — Coinbase, AgentKit, MCP" },
            { k: "Base", v: "USDC settlement, on-chain receipt" },
          ].map((m) => (
            <div key={m.v}>
              <div className="text-[clamp(36px,5.4vw,64px)] font-medium leading-none tracking-[-0.05em] text-white">
                {m.k}
              </div>
              <p className="mt-4 text-[15px] text-[var(--body-mid)]">{m.v}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="start" className="scroll-mt-24 px-5 py-28 md:px-8">
        <div className="mx-auto max-w-[1400px]">
          <h2 className="text-center text-[clamp(32px,4.5vw,48px)] font-medium leading-[1.05] tracking-[-0.03em] text-white">
            Two surfaces. One settlement rail.
          </h2>
          <div className="mt-14 grid gap-4 lg:grid-cols-2">
            <article className="flex flex-col rounded-[24px] border border-[var(--hairline)] bg-[var(--canvas-card)] p-8 sm:p-10">
              <h3 className="text-[28px] font-medium tracking-tight text-white">
                Device operators
              </h3>
              <p className="mt-2 text-[15px] text-[var(--body-mid)]">
                Expose silicon as inventory. Capture yield on every agent call.
              </p>
              <ul className="mt-8 flex-1 space-y-3.5 text-[15px] text-[var(--body)]">
                {[
                  "ESP32 / Arduino wrap() — no payment firmware",
                  "Meter motors, probes, UAV payloads independently",
                  "USDC clears to your wallet on Base or Solana",
                  "Public deviceId; private connector stays off-agent",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--body-mid)]" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <a href={routes.signup} className="landing-pill-fill mt-10 w-full py-3.5">
                Provision a device
              </a>
            </article>

            <article className="flex flex-col rounded-[24px] border border-[var(--hairline)] bg-[var(--canvas-card)] p-8 sm:p-10">
              <h3 className="text-[28px] font-medium tracking-tight text-white">
                Agent integrators
              </h3>
              <p className="mt-2 text-[15px] text-[var(--body-mid)]">
                Give Claude and ChatGPT a funded x402 client. They buy the
                physical world.
              </p>
              <ul className="mt-8 flex-1 space-y-3.5 text-[15px] text-[var(--body)]">
                {[
                  "MCP server for Claude Desktop — keys stay on disk",
                  "x402-fetch / AgentKit — same adapter as software APIs",
                  "skills.md for autonomous discovery at runtime",
                  "Password gates when a fleet must stay private",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--body-mid)]" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <a href={site.docs} className="landing-pill mt-10 w-full py-3.5">
                Wire an agent
              </a>
            </article>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--hairline)] px-5 py-16 md:px-8">
        <div className="mx-auto grid max-w-[1400px] gap-12 md:grid-cols-[1.2fr_repeat(3,1fr)]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <BaseMark size={20} tone="on-dark" />
              <span className="text-[14px] text-white">0xBs</span>
            </Link>
            <p className="mt-4 max-w-[18rem] text-[13px] leading-relaxed text-[var(--body-mid)]">
              Machine-payable infrastructure for physical AI.
            </p>
            <p className="mt-3 text-[13px] text-[var(--body-mid)]">
              © {new Date().getFullYear()} 0xBs
            </p>
          </div>
          {[
            {
              h: "Product",
              links: [
                { l: "Proof", href: "#proof" },
                { l: "MCU merchants", href: "#silicon" },
                { l: "Console", href: routes.login },
              ],
            },
            {
              h: "Developers",
              links: [
                { l: "Docs", href: site.docs },
                { l: "Firmware SDK", href: `${site.docs}/docs/firmware` },
                { l: "Arduino library", href: site.sdk },
                { l: "x402 standard", href: site.x402 },
              ],
            },
            {
              h: "Proof",
              links: [
                { l: "Demo", href: site.tweet },
                { l: "On-chain tx", href: site.tx },
              ],
            },
          ].map((col) => (
            <div key={col.h}>
              <h4 className="text-[13px] text-white">{col.h}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((x) => (
                  <li key={x.l}>
                    <a
                      href={x.href}
                      className="text-[13px] text-[var(--body-mid)] transition-colors hover:text-white"
                    >
                      {x.l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
