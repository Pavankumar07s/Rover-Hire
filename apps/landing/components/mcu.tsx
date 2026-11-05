import Image from "next/image";

export function LandingMcu({ docs }: { docs: string }) {
  return (
    <section id="silicon" className="scroll-mt-24 px-5 pb-28 md:px-8">
      <div className="mx-auto grid max-w-[1400px] items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div className="relative min-h-[320px] overflow-hidden rounded-[22px] border border-[var(--hairline)] md:min-h-[420px]">
          <Image
            src="/generated/esp32-node.jpg"
            alt="ESP32-class microcontroller — commodity silicon as a globally addressable merchant"
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
        <div>
          <p className="text-[13px] tracking-[0.16em] text-[var(--body-mid)] uppercase">
            MCU-class merchants
          </p>
          <h2 className="mt-3 text-[clamp(32px,4.4vw,48px)] font-medium leading-[1.05] tracking-[-0.03em] text-white">
            A $3 device accepts agent payments from anywhere.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-white/50">
            The microcontroller does not custody keys, run a wallet, or speak
            PCI. It wraps a function. When a funded agent anywhere on the public
            internet presents an x402 client, settlement clears to the operator
            wallet, then GPIO fulfills. Commodity ESP32 silicon becomes a
            globally addressable merchant — no acquiring bank, no firmware
            rewrite of the payment plane.
          </p>
          <ul className="mt-8 space-y-4 text-[15px] text-white/70">
            {[
              "wrap() is the commercial surface — static or argument-derived USDC quotes",
              "Settlement lives off-device; the MCU is a fulfillment node",
              "Sensor telemetry is the same primitive: paywalled, globally callable",
              "Robotics and UAV payloads inherit the identical HTTP 402 contract",
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--sunset)]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <a
            href={`${docs}/docs/firmware`}
            className="mt-8 inline-flex text-[14px] text-white/55 transition-colors hover:text-white"
          >
            Firmware SDK — wrap a function →
          </a>
        </div>
      </div>
    </section>
  );
}
