import type { Metadata } from "next";
import { Article, H2 } from "../../components";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What to keep private in 0xBS: the connectorId (MQTT transport identity), device API keys, and access passwords — and why public deviceIds are safe to share.",
  alternates: { canonical: "/docs/security" },
};

export default function Page() {
  return (
    <Article
      href="/docs/security"
      title="Security"
      lead="A short list of what is safe to share and what must stay secret."
      headings={["Safe to share", "Keep private", "Why the public/private split matters"]}
    >
      <H2>Safe to share</H2>
      <ul>
        <li>
          <strong>
            <code>deviceId</code>
          </strong>{" "}
          — public. It only lets someone <em>call</em> a service (and pay for
          paid ones). It cannot reach the device transport.
        </li>
        <li>
          <strong>
            <code>serviceId</code>
          </strong>{" "}
          — public. Returned by discovery.
        </li>
      </ul>

      <H2>Keep private</H2>
      <ul>
        <li>
          <strong>
            <code>connectorId</code>
          </strong>{" "}
          — the MQTT transport identity. All device topics are keyed by it.
          Never returned by any public/agent route; returned only to the
          authenticated owner. Treat it like a secret and never paste it into
          agent prompts, logs, or client-side code.
        </li>
        <li>
          <strong>API key</strong> — shown once at creation. The device uses it
          to authenticate its replies. Only the SHA-256 hash is stored; rotate
          if leaked.
        </li>
        <li>
          <strong>Access password</strong> — for password-protected services.
          Only a hash is stored; it is never returned by any endpoint.
        </li>
        <li>
          <strong>Payout wallet</strong> — the recipient address is
          configuration, not returned by public discovery.
        </li>
      </ul>

      <H2>Why the public/private split matters</H2>
      <p>
        Separating the public <code>deviceId</code> from the private{" "}
        <code>connectorId</code> means the identifier agents see (and that
        appears in URLs, logs, and discovery) is decoupled from the one that can
        talk to the hardware. A leaked <code>deviceId</code> lets someone call
        your services — which is the whole point — but never lets them
        impersonate the device, publish to its command topic, or eavesdrop on
        its replies. The server is the only party that maps public id → private
        connectorId.
      </p>
    </Article>
  );
}
