import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Article, Code, DocLink, H2 } from "../../components";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Firmware SDK",
  description:
    "Wrap any ESP32 function into a globally addressable x402 merchant. Commodity MCU silicon accepts USDC from Claude, ChatGPT, and any funded agent — no on-device wallet.",
  alternates: { canonical: "/docs/firmware" },
};

export default function Page() {
  return (
    <Article
      href="/docs/firmware"
      title="Firmware SDK — wrap() as a merchant"
      lead="A $3 ESP32 does not custody keys or speak PCI. It wraps a function. Agents anywhere settle USDC; the MCU fulfills."
      headings={[
        "The commercial surface",
        "Install",
        "Wrap an existing function",
        "What the MCU never does",
        "Examples",
      ]}
    >
      <H2>The commercial surface</H2>
      <p>
        0xBs treats MCU-class silicon as a <strong>fulfillment node</strong>,
        not a wallet. Payment negotiation lives on the control plane (HTTP 402 /
        x402). Firmware exposes capabilities through <code>wrap()</code> and
        optional <code>setPrice()</code>. When a funded agent — Claude via MCP,
        ChatGPT via an Action, or any <code>x402-fetch</code> client — invokes
        the public device, settlement clears to the operator wallet, then MQTT
        delivers the command. GPIO, sensors, and actuators run only after
        settlement.
      </p>

      <H2>Install</H2>
      <p>
        Arduino library: clone{" "}
        <DocLink href={site.sdk}>OxBS</DocLink> into{" "}
        <code>~/Documents/Arduino/libraries</code>, or add the clean{" "}
        <code>OxBS.zip</code>. Install <code>PubSubClient</code> and ArduinoJson
        v7. Connect Wi-Fi in your sketch — the SDK never calls{" "}
        <code>WiFi.begin()</code>.
      </p>

      <H2>Wrap an existing function</H2>
      <p>
        From the console, copy <code>connectorId</code>, the one-time{" "}
        <code>apiKey</code>, and each <code>serviceId</code>. Do not flash the
        public <code>deviceId</code>.
      </p>
      <Code lang="cpp">{`#include <WiFi.h>
#include <OxBS.h>

OxBS oxbs;

void setup() {
  WiFi.begin("WIFI_SSID", "WIFI_PASSWORD");
  while (WiFi.status() != WL_CONNECTED) delay(500);

  oxbs.wrap("FORWARD_SERVICE_ID", [](JsonVariantConst args, JsonObject result) {
    int seconds = constrain((int)(args["seconds"] | 1), 1, 6);
    driveForward();
    oxbs.wait(seconds * 1000);
    stopMotors();
    result["action"] = "forward";
    result["seconds"] = seconds;
  });
  oxbs.setPrice("FORWARD_SERVICE_ID", [](JsonVariantConst args) {
    int seconds = constrain((int)(args["seconds"] | 1), 1, 6);
    return OxBS::usd(seconds * 0.01f);
  });

  oxbs.begin("CONNECTOR_ID", "API_KEY");
}

void loop() {
  oxbs.loop();
}`}</Code>
      <p>
        Static quotes use <code>oxbs.setPrice(id, &quot;$0.01&quot;)</code>.
        Dynamic quotes take a function of the agent&apos;s <code>params</code>.
        Inside <code>wrap</code>, use <code>oxbs.wait(ms)</code> instead of{" "}
        <code>delay</code> so the MQTT session stays alive.
      </p>

      <H2>What the MCU never does</H2>
      <ul>
        <li>No on-device wallet, seed, or EIP-3009 signer.</li>
        <li>No HTTP 402 parser on the silicon.</li>
        <li>
          No public internet listener. The device is an MQTT subscriber; the
          control plane is the only party that maps <code>deviceId</code> →{" "}
          <code>connectorId</code>.
        </li>
      </ul>
      <p>
        That split is the point: commodity BOM becomes a globally addressable
        merchant because the payment rail is off-device and standard.
      </p>

      <H2>Examples</H2>
      <ul>
        <li>
          <code>sdk/examples/L298NCar</code> — motors priced per second of
          actuation.
        </li>
        <li>
          <code>sdk/examples/WrapService</code> — static vs argument-derived
          quotes on an onboard LED.
        </li>
      </ul>

      <Callout title="Next">
        Register the device first:{" "}
        <DocLink href="/docs/connect-device">Connect a device</DocLink>. Then
        share the public <code>deviceId</code> with agents —{" "}
        <DocLink href="/docs/agents">Claude &amp; ChatGPT</DocLink>.
      </Callout>
    </Article>
  );
}
