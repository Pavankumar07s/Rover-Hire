import Image from "next/image";
import { PlayIcon } from "./icons";

export function LandingProof({
  tweet,
  tx,
}: {
  tweet: string;
  tx: string;
}) {
  return (
    <section id="proof" className="scroll-mt-24 px-5 pb-24 md:px-8">
      <div className="mx-auto grid max-w-[1400px] items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <a
          href={tweet}
          className="group relative overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-black"
        >
          <Image
            src="/generated/demo-poster.jpg"
            alt="Claude discovering 0xBs devices and actuating an ESP32 chassis after USDC settlement"
            width={1200}
            height={675}
            className="h-auto w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm transition-transform group-hover:scale-105">
              <PlayIcon className="ml-0.5 h-6 w-6 text-white" />
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5">
            <p className="max-w-sm text-left text-[13px] leading-snug text-white/85">
              Claude · discovery · x402 settlement · L298N chassis
            </p>
            <span className="text-[12px] text-white/50">Watch proof →</span>
          </div>
        </a>

        <div>
          <p className="text-[13px] tracking-[0.16em] text-[var(--body-mid)] uppercase">
            Settlement proof
          </p>
          <h2 className="mt-3 text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.08] tracking-[-0.03em] text-white">
            Prompt Claude.
            <br />
            Hardware executes.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-white/50">
            An operator flashes an ESP32. An agent issues a natural-language
            instruction. The control plane prices the service, challenges with
            HTTP 402, clears USDC on Base, and relays the command over MQTT.
            Motors fire. The receipt is on-chain.
          </p>
          <dl className="mt-8 space-y-4 border-t border-[var(--hairline)] pt-6">
            <div>
              <dt className="text-[12px] text-[var(--body-mid)]">Pipeline</dt>
              <dd className="mt-1 font-mono text-[13px] text-white">
                x402 → ESP32 → motors
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-[var(--body-mid)]">
                Base transaction
              </dt>
              <dd className="mt-1">
                <a
                  href={tx}
                  className="font-mono text-[12.5px] text-white/70 break-all transition-colors hover:text-white"
                >
                  0xfa081a6d…a26da178
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
