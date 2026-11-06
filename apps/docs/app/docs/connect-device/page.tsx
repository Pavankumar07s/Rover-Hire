import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Article, Code, DocLink } from "../../components";

export const metadata: Metadata = {
  title: "Connect a device",
  description:
    "Device-owner guide: register a device, get its private connectorId and API key, and connect ESP32 / IoT firmware to the MQTT transport.",
  alternates: { canonical: "/docs/connect-device" },
};

export default function Page() {
  return (
    <Article
      href="/docs/connect-device"
      title="Connect a device"
      lead="Register hardware, flash connector credentials, and expose services. Prefer the Firmware SDK wrap() path over hand-rolled MQTT."
    >
      <Steps>
        <Step>
          <h3>Register the device</h3>
          <p>From the dashboard, create a device. You receive three things:</p>
          <ul>
            <li>
              <code>deviceId</code> — <strong>public</strong>. Share it with
              agents.
            </li>
            <li>
              <code>connectorId</code> — <strong>private</strong>. Flash it into
              firmware; never share it.
            </li>
            <li>
              <code>apiKey</code> — <strong>secret</strong>, shown once. The
              device sends it back on each reply to authenticate itself.
            </li>
          </ul>
        </Step>
        <Step>
          <h3>Connect over MQTT</h3>
          <p>
            Preferred path: the{" "}
            <DocLink href="/docs/firmware">OxBS Firmware SDK</DocLink> —{" "}
            <code>wrap()</code>, <code>setPrice()</code>, <code>begin()</code>.
            The library owns the MQTT session. Hand-roll only if you are not on
            ESP32 / Arduino.
          </p>
          <p>
            The device connects using its <code>connectorId</code> as the MQTT
            client id, and subscribes to its command topic. All topics are keyed
            by the <code>connectorId</code>:
          </p>
          <Code lang="text">{`d/<connectorId>/cmd      # server → device: a command
d/<connectorId>/reply    # device → server: a result
d/<connectorId>/status   # device → server: online/offline`}</Code>
        </Step>
        <Step>
          <h3>Respond to commands</h3>
          <p>
            The server publishes <code>GET_QUOTE</code> (price) and{" "}
            <code>GET_RESULT</code> (do the work) commands. The device replies
            on the reply topic, echoing <code>reqId</code>, the{" "}
            <code>service_id</code>, and its raw <code>api_key</code>:
          </p>
          <Code lang="json">{`{
  "type": "GET_RESULT",
  "reqId": "a1b2c3d4",
  "service_id": "455e8ec1-…",
  "api_key": "bs_…",
  "result": "OK-1"
}`}</Code>
          <p>
            A runnable ESP32 stand-in lives in <code>simulations/esp.ts</code>.
            Set <code>CONNECTOR_ID</code> to your device&apos;s connectorId.
          </p>
        </Step>
        <Step>
          <h3>Add services</h3>
          <p>
            Create one service per capability. Set the type (free/paid), payout
            wallet + chain (for paid), password protection, and the argument
            schema (<code>name</code>, <code>type</code>, <code>required</code>,{" "}
            <code>description</code>). Agents read that schema via{" "}
            <DocLink href="/docs/discovery">discovery</DocLink>.
          </p>
        </Step>
      </Steps>

      <Callout type="warn" title="Keep private">
        The <code>connectorId</code> and <code>apiKey</code> are secrets. See{" "}
        <DocLink href="/docs/security">Security</DocLink>.
      </Callout>
    </Article>
  );
}
