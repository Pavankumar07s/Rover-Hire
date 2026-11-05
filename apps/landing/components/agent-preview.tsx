"use client";

import { useEffect, useRef, useState } from "react";

type Step = {
  prompt: string;
  service: string;
  price: string;
  reply: string;
};

const STEPS: Step[] = [
  {
    prompt: "Move the car forward for two seconds.",
    service: "l298n-car · forward",
    price: "$0.02",
    reply: "Motors engaged · 2.0s · settled 0.02 USDC on Base",
  },
  {
    prompt: "Purchase the latest soil-moisture reading from greenhouse #4.",
    service: "greenhouse-4 · read-sensors",
    price: "$0.001",
    reply: "24.3°C · 61% RH · 18.4% VWC · paid $0.001 USDC",
  },
  {
    prompt: "Dispatch the north-field UAV for a 12 hectare survey.",
    service: "drone-fleet · aerial-survey",
    price: "$2.00",
    reply: "UAV-3 airborne · 12 ha mapped · 84 frames · paid $2.00 USDC",
  },
];

const TYPE_MS = 18;
const HOLD_AFTER_TYPE_MS = 350;
const AFTER_REPLY_MS = 2800;

export function AgentPreview() {
  const first = STEPS[0]!;
  const [stepIdx, setStepIdx] = useState(0);
  const [typed, setTyped] = useState(first.prompt);
  const [phase, setPhase] = useState<"typing" | "routing" | "paying" | "reply">(
    "reply",
  );
  const started = useRef(false);
  const reduced = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const step = STEPS[stepIdx];
    if (!step) return;

    if (!started.current) {
      started.current = true;
      const t = setTimeout(
        () => setStepIdx((n) => (n + 1) % STEPS.length),
        AFTER_REPLY_MS,
      );
      timers.current.push(t);
      return () => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
      };
    }
    const push = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, reduced.current ? Math.min(ms, 300) : ms);
      timers.current.push(t);
    };

    setTyped("");
    setPhase("typing");

    let i = 0;
    const typeTick = () => {
      i += 1;
      setTyped(step.prompt.slice(0, i));
      if (i < step.prompt.length) {
        push(typeTick, TYPE_MS);
      } else {
        push(() => setPhase("routing"), HOLD_AFTER_TYPE_MS);
        push(() => setPhase(step.price ? "paying" : "reply"), 900);
        if (step.price) push(() => setPhase("reply"), 1700);
        push(
          () => setStepIdx((n) => (n + 1) % STEPS.length),
          step.price ? 1700 + AFTER_REPLY_MS : 900 + AFTER_REPLY_MS,
        );
      }
    };
    push(typeTick, TYPE_MS);

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [stepIdx]);

  const step = STEPS[stepIdx]!;
  const showReply = phase === "reply";

  return (
    <div className="flex h-full min-h-[280px] flex-col justify-end gap-2.5 p-5 text-[13px] leading-snug">
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-2xl rounded-br-md bg-[#2a2c31] px-3.5 py-2.5 text-[#ececec]">
          {typed}
          {phase === "typing" && (
            <span className="ml-0.5 inline-block h-3.5 w-[1.5px] translate-y-0.5 animate-pulse bg-white/80" />
          )}
        </div>
      </div>

      {phase !== "typing" && (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] text-[var(--body-mid)]">
            Routed to{" "}
            <span className="font-mono text-[#c9ccd1]">{step.service}</span>
          </div>
          {step.price ? (
            <div className="text-[11px] text-[var(--body-mid)]">
              x402 · {step.price} USDC
              {phase === "paying" ? " · settling…" : " · settled on Base"}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--body-mid)]">
              unmetered service
            </div>
          )}
          <div
            className={`transition-all duration-300 ${
              showReply ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-[#1c1e22] px-3.5 py-2.5 text-[#d5d7db]">
              {step.reply}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
