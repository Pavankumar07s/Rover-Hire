import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Article, DocLink, H2 } from "../../components";

export const metadata: Metadata = {
  title: "Core concepts",
  description:
    "Devices, services, identifiers, and the x402 rail that turns MCU-class silicon into a globally addressable merchant.",
  alternates: { canonical: "/docs/concepts" },
};

export default function Page() {
  return (
    <Article
      href="/docs/concepts"
      title="Core concepts"
      lead="Devices, services, identifiers, and the x402 settlement rail that turns MCU-class silicon into a globally addressable merchant."
      headings={[
        "Devices and services",
        "Identifiers",
        "Service types",
        "Password protection",
        "x402 in one paragraph",
        "MCU-class merchants",
      ]}
    >
      <H2>Devices and services</H2>
      <p>
        A <strong>device</strong> is a piece of hardware (an ESP32, a gateway, a
        chassis, a UAV). A device is an identity — everything callable lives on
        its <strong>services</strong>. Each service is one capability (actuate
        motors, emit a sensor sample, arm a payload) with its own USDC quote,
        payout wallet, access rules, and argument schema. Agents purchase the
        capability; the MCU fulfills after settlement.
      </p>

      <H2>Identifiers</H2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Visibility</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>deviceId</code>
            </td>
            <td>Public — share freely</td>
            <td>Addressing a device from an agent (appears in the URL).</td>
          </tr>
          <tr>
            <td>
              <code>serviceId</code>
            </td>
            <td>Public — returned by discovery</td>
            <td>Addressing a specific capability.</td>
          </tr>
          <tr>
            <td>
              <code>connectorId</code>
            </td>
            <td>
              <strong>Private — never share</strong>
            </td>
            <td>The server↔device MQTT transport identity.</td>
          </tr>
        </tbody>
      </table>
      <Callout type="warn" title="connectorId is a secret">
        It is never returned by any public or agent-facing endpoint. Knowing a
        public <code>deviceId</code> lets you <em>call</em> a device, but can
        never be used to reach its transport directly. See{" "}
        <DocLink href="/docs/security">Security</DocLink>.
      </Callout>

      <H2>Service types</H2>
      <ul>
        <li>
          <strong>FREE</strong> — the call returns the device result directly (
          <code>201</code>). No wallet.
        </li>
        <li>
          <strong>PAID</strong> — the call requires a USDC payment over x402
          before the device runs the work.
        </li>
      </ul>

      <H2>Password protection</H2>
      <p>
        Any service (free or paid) can require a{" "}
        <strong>username + password</strong> set by the owner. Callers supply
        them in the request body or via <code>x-access-username</code> /{" "}
        <code>x-access-password</code> headers.
      </p>

      <H2>x402 in one paragraph</H2>
      <p>
        x402 is the open HTTP <code>402 Payment Required</code> standard. A paid
        endpoint answers a plain request with a <code>402</code> that describes
        what to pay. An x402 client signs a stablecoin payment, adds an{" "}
        <code>X-PAYMENT</code> header, and retries — the server verifies,
        settles, and returns the result plus an <code>X-PAYMENT-RESPONSE</code>{" "}
        receipt. 0xBS speaks the standard v1 wire format, so any x402 client
        works. The microcontroller never parses 402; it is a fulfillment node
        behind MQTT.
      </p>

      <H2>MCU-class merchants</H2>
      <p>
        Commodity ESP32 boards (~$3 BOM) accept agent payments from any
        jurisdiction that can reach the public API. Settlement is off-device.{" "}
        <code>wrap()</code> is the entire commercial surface. See the{" "}
        <DocLink href="/docs/firmware">Firmware SDK</DocLink>.
      </p>
    </Article>
  );
}
