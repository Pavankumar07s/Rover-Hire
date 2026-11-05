const STEPS = [
  {
    k: "01",
    title: "Prompt",
    body: "An agent — Claude, ChatGPT, or any MCP-capable runtime — receives a natural-language instruction: actuate a chassis, poll a probe, dispatch a UAV.",
  },
  {
    k: "02",
    title: "Discover",
    body: "It fetches the public device contract. Argument schemas, price, and payout rail are machine-readable. No proprietary SDK on the agent side.",
  },
  {
    k: "03",
    title: "Settle",
    body: "Paid services answer HTTP 402. The x402 adapter presents USDC. Settlement clears to the operator wallet on Base or Solana before a single GPIO toggles.",
  },
  {
    k: "04",
    title: "Fulfill",
    body: "The control plane relays over private MQTT. The MCU runs the wrapped function — motors, telemetry, payload — and returns a receipt to the agent.",
  },
];

export function LandingLoop() {
  return (
    <section id="loop" className="scroll-mt-24 px-5 pb-28 md:px-8">
      <div className="mx-auto max-w-[1400px]">
        <p className="text-[13px] tracking-[0.16em] text-[var(--body-mid)] uppercase">
          Control loop
        </p>
        <h2 className="mt-3 max-w-[18ch] text-[clamp(32px,4.4vw,48px)] font-medium leading-[1.05] tracking-[-0.03em] text-white">
          From inference to actuation in a single paid request.
        </h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[var(--hairline)] sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <article
              key={step.k}
              className="bg-[var(--canvas-card)] px-6 py-8"
            >
              <p className="font-mono text-[12px] text-[var(--sunset)]">
                {step.k}
              </p>
              <h3 className="mt-4 text-[20px] font-medium tracking-tight text-white">
                {step.title}
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-white/45">
                {step.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
