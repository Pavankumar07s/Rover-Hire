import { Cards, Card } from "fumadocs-ui/components/card";
import { Callout } from "fumadocs-ui/components/callout";
import { Article, DocLink, H2 } from "./components";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <Article
      href="/"
      title="Prompt an agent. Hardware settles and moves."
      lead="0xBS is the machine-payable control plane for physical AI. Claude, ChatGPT, and any x402 client discover MCU-class devices, settle USDC, and invoke motors, sensors, robotics, and UAV payloads — globally, per call."
      headings={["What 0xBS is", "Why it exists", "The loop"]}
    >
      <Cards>
        <Card
          title="Quickstart"
          href="/docs/quickstart"
          description="Discover a device contract and settle a call."
        />
        <Card
          title="Claude & ChatGPT"
          href="/docs/agents"
          description="Prompt an agent. Hardware executes."
        />
        <Card
          title="Firmware SDK"
          href="/docs/firmware"
          description="wrap() — MCU-class silicon as a merchant."
        />
      </Cards>

      <H2>What 0xBS is</H2>
      <p>
        An operator flashes an ESP32 (or any MQTT device) and{" "}
        <DocLink href="/docs/firmware">wraps</DocLink> existing functions —
        drive forward, read a probe, arm a payload. Each function becomes a{" "}
        <em>service</em> with a USDC quote. AI agents fetch the public contract
        and call it over <DocLink href={site.x402}>x402</DocLink>. Paid
        services challenge with HTTP 402; settlement clears to the operator
        wallet on Base or Solana; then the MCU fulfills. The agent never sees
        MQTT. The silicon never holds a wallet.
      </p>

      <H2>Why it exists</H2>
      <ul>
        <li>
          <strong>Physical AI needs a payment rail.</strong> Inference already
          has APIs. Motors, sensors, and UAVs did not. 0xBS is that rail.
        </li>
        <li>
          <strong>MCU-class merchants.</strong> Commodity ~$3 ESP32 boards
          become globally addressable endpoints. No acquiring bank, no on-device
          signer, no firmware rewrite of the payment plane.
        </li>
        <li>
          <strong>Telemetry as inventory.</strong> Sensor readings are metered
          primitives. Agents purchase a sample from any jurisdiction the public
          internet reaches; operators capture micropayment yield per poll.
        </li>
        <li>
          <strong>Standard, not proprietary.</strong>{" "}
          <code>x402-fetch</code>, AgentKit, MCP — the same adapters used for
          software APIs.
        </li>
      </ul>

      <H2>The loop</H2>
      <ol>
        <li>
          Prompt: <em>“Move the car forward two seconds”</em> or{" "}
          <em>“Purchase greenhouse #4 soil moisture.”</em>
        </li>
        <li>
          The agent loads{" "}
          <code>GET /public/device/&#123;deviceId&#125;</code> and reads argument
          schemas, price, and payout rail.
        </li>
        <li>
          It POSTs to{" "}
          <code>/quote/device/&#123;deviceId&#125;/service/&#123;serviceId&#125;</code>.
          Free → result. Paid → <code>402</code>; the x402 adapter settles USDC
          and retries.
        </li>
        <li>
          The control plane relays over private MQTT. The wrapped function runs.
          The agent receives the result plus a settlement receipt.
        </li>
      </ol>

      <Callout title="Where to start">
        Operators: <DocLink href="/docs/firmware">Firmware SDK</DocLink>.
        Integrators: <DocLink href="/docs/quickstart">Quickstart</DocLink> or{" "}
        <DocLink href="/docs/agents">Claude &amp; ChatGPT</DocLink>.
      </Callout>

      <p>
        API base in examples: <code>{site.apiUrl}</code>
      </p>
    </Article>
  );
}
