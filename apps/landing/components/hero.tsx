"use client";

import { useEffect, useState } from "react";
import { ArrowRight, PlayIcon } from "./icons";

const WORDS = ["motors", "sensors", "UAVs", "robots"] as const;

function WordRotator() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const id = setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIndex((n) => (n + 1) % WORDS.length);
        setVisible(true);
      }, 220);
    }, 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="inline-block transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {WORDS[index]}.
    </span>
  );
}

export function LandingHero({
  signup,
  docs,
  tweet,
}: {
  signup: string;
  docs: string;
  tweet: string;
}) {
  return (
    <section className="relative flex flex-col items-center px-5 pb-16 pt-24 text-center md:px-8 md:pt-32">
      <a
        href="#proof"
        className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-[var(--hairline-strong)] bg-black/40 py-1.5 pl-1.5 pr-2.5 text-[13px] text-[var(--body)] transition-colors hover:border-white/35 hover:text-white"
      >
        <span className="rounded-[5px] bg-[var(--sunset)] px-1.5 py-[1px] text-[10px] font-medium tracking-wide text-white">
          LIVE
        </span>
        <span>Prompt Claude · USDC on Base · chassis actuates</span>
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/20">
          <PlayIcon className="h-2.5 w-2.5" />
        </span>
      </a>

      <h1 className="max-w-[20ch] text-[clamp(40px,5.8vw,68px)] font-medium leading-[0.98] tracking-[-0.035em] text-white">
        Agents don&apos;t need
        <br />
        a remote. They pay
        <br />
        your <WordRotator />
      </h1>

      <p className="mt-6 max-w-[40rem] text-[18px] leading-relaxed text-white/50">
        0xBs is the machine-payable control plane for physical AI. Wrap any
        microcontroller into a globally addressable x402 endpoint. Claude,
        ChatGPT, and any funded agent discover the device, settle USDC, and
        invoke actuation or telemetry — no merchant account, no firmware payment
        stack.
      </p>

      <p className="mt-4 font-mono text-[12px] tracking-[0.14em] text-white/35 uppercase">
        x402 → ESP32 → motors
      </p>

      <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
        <a href={signup} className="landing-pill-fill px-5 py-3">
          Provision silicon
          <ArrowRight />
        </a>
        <a href={docs} className="landing-pill px-5 py-3">
          Agent integration
        </a>
        <a href={tweet} className="landing-pill px-5 py-3">
          Watch the settlement
        </a>
      </div>
    </section>
  );
}
