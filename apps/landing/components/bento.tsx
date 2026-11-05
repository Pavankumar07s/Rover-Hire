import Image from "next/image";
import Link from "next/link";
import { AgentPreview } from "./agent-preview";

function CardLabel({ name }: { name: string }) {
  return (
    <div className="pointer-events-none relative z-10 flex items-center justify-between px-5 py-4">
      <span className="text-[15px] text-white">{name}</span>
      <span className="text-[13px] text-[var(--body-mid)]">
        Explore <span aria-hidden="true">→</span>
      </span>
    </div>
  );
}

function BuildPreview() {
  return (
    <div className="flex h-full min-h-[280px] flex-col justify-end p-5 font-mono text-[12px] leading-6">
      <div className="mb-3 flex items-center justify-between text-[11px] text-[var(--body-mid)]">
        <span>esp32-c3 · wrap()</span>
        <span>$3 BOM</span>
      </div>
      <div className="space-y-0.5 text-[#c9ccd1]">
        <div>
          <span className="text-[var(--body-mid)]">❯</span> oxbs.wrap(forward, drive)
        </div>
        <div className="text-[var(--body-mid)]">pricing callback…</div>
        <div>
          <span className="text-[#7d9ec9]">▸</span> setPrice usd(seconds * 0.01)
        </div>
        <div>
          <span className="text-[#7d9ec9]">▸</span> mqtt attach · TLS 8883
        </div>
        <div>
          <span className="text-[#7d9ec9]">▸</span> endpoint live · x402
        </div>
        <div className="text-[#9dba8a]">merchant online · agents can settle</div>
      </div>
    </div>
  );
}

function SettlePreview() {
  return (
    <div className="flex h-full min-h-[280px] flex-col justify-end gap-3 p-5 text-[13px]">
      <div className="text-[13px] text-white">Metered telemetry · last hour</div>
      <ul className="space-y-2 text-[13px] text-[#d5d7db]">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 text-[#9dba8a]">✓</span>
          <span>soil-probe · 412 polls · +$0.41 USDC</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 text-[#9dba8a]">✓</span>
          <span>forward · 18 actuations · +$0.36 USDC</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 text-[#9dba8a]">✓</span>
          <span>Cleared to operator wallet on Base</span>
        </li>
      </ul>
      <div className="flex items-center gap-1.5 pt-1 text-[12px] text-[var(--body-mid)]">
        <span className="flex gap-0.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sunset)]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sunset)] [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sunset)] [animation-delay:300ms]" />
        </span>
        Agents polling
      </div>
    </div>
  );
}

export function LandingBento({
  signup,
  docs,
}: {
  signup: string;
  docs: string;
}) {
  return (
    <section id="product" className="scroll-mt-24 px-4 pb-24 md:px-8">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-3 md:grid-cols-3">
        <article className="relative flex min-h-[360px] flex-col overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[var(--canvas-card)] transition-colors hover:border-white/20">
          <Link href="#loop" className="absolute inset-0 z-20" aria-label="Agents" />
          <div className="flex-1">
            <AgentPreview />
          </div>
          <CardLabel name="Agent runtime" />
        </article>

        <article className="relative flex min-h-[360px] flex-col overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[var(--canvas-card)] transition-colors hover:border-white/20">
          <Link href="#silicon" className="absolute inset-0 z-20" aria-label="Wrap" />
          <div className="flex-1">
            <BuildPreview />
          </div>
          <CardLabel name="wrap()" />
        </article>

        <article className="relative flex min-h-[360px] flex-col overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[var(--canvas-card)] transition-colors hover:border-white/20">
          <Link href="#start" className="absolute inset-0 z-20" aria-label="Yield" />
          <div className="flex-1">
            <SettlePreview />
          </div>
          <CardLabel name="Micropayment yield" />
        </article>

        <article className="relative min-h-[280px] overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[var(--canvas-card)] transition-colors hover:border-white/20 md:col-span-2 md:min-h-[400px]">
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-1 p-1">
            <div className="relative row-span-2 overflow-hidden rounded-[18px]">
              <Image
                src="/generated/robot-car.jpg"
                alt="ESP32 chassis — motors as a paid x402 service"
                fill
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-cover"
                priority
              />
            </div>
            <div className="relative overflow-hidden rounded-[18px]">
              <Image
                src="/generated/hardware-robot.jpg"
                alt="Industrial arm exposed as a callable 0xBs service"
                fill
                sizes="(min-width: 768px) 22vw, 50vw"
                className="object-cover"
              />
            </div>
            <div className="relative overflow-hidden rounded-[18px]">
              <Image
                src="/generated/hardware-sensor.jpg"
                alt="Paywalled sensor nodes for agent-purchased telemetry"
                fill
                sizes="(min-width: 768px) 22vw, 50vw"
                className="object-cover"
              />
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-0">
            <CardLabel name="Physical AI" />
          </div>
          <Link href={signup} className="absolute inset-0 z-20" aria-label="Physical AI" />
        </article>

        <article className="relative min-h-[280px] overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[var(--canvas-card)] transition-colors hover:border-white/20 md:min-h-[400px]">
          <Image
            src="/generated/uav.jpg"
            alt="Inspection UAV dispatched as a metered 0xBs mission"
            fill
            sizes="(min-width: 768px) 33vw, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0">
            <CardLabel name="UAV payloads" />
          </div>
          <Link href={docs} className="absolute inset-0 z-20" aria-label="UAV payloads" />
        </article>
      </div>
    </section>
  );
}
