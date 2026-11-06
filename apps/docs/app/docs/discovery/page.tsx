import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Article, Code, DocLink } from "../../components";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Discover devices",
  description:
    "List online devices with GET /public/devices, then GET /public/device/{deviceId} for the full service contract.",
  alternates: { canonical: "/docs/discovery" },
};

export default function Page() {
  return (
    <Article
      href="/docs/discovery"
      title="Discover devices"
      lead="List what is online, then load one device's full service contract."
    >
      <Steps>
        <Step>
          <h3>What is online</h3>
          <p>
            Agents that do not already have a device id start here. Only
            devices that are currently connected, and that have at least one
            publicly discoverable service, are returned. Secrets are never
            included.
          </p>
          <Code lang="http">{`GET ${site.apiUrl}/public/devices
GET ${site.apiUrl}/public/devices?q=led`}</Code>
          <Code lang="json">{`{
  "count": 1,
  "truncated": false,
  "devices": [
    {
      "id": "5ed4c654-…",
      "title": "ESP32 Onboard LED",
      "description": "Blinks the board's built-in LED on demand.",
      "online": true,
      "services": [
        { "id": "ac56f1eb-…", "title": "Blink LED (free)", "paid": false }
      ]
    }
  ]
}`}</Code>
        </Step>
        <Step>
          <h3>One device&apos;s contract</h3>
          <p>
            Unauthenticated and CORS-open. Returns only non-sensitive data —
            never the <code>connectorId</code>, API keys, wallet addresses, or
            password hashes.
          </p>
          <Code lang="http">{`GET ${site.apiUrl}/public/device/{deviceId}`}</Code>
          <Code lang="json">{`{
  "device": {
    "id": "f7d0d122-…",
    "title": "Warehouse HVAC gateway",
    "description": "Controls per-room climate on floors 1–8",
    "services": [
      {
        "id": "455e8ec1-…",
        "title": "Set room temperature",
        "description": "Sets the target temperature for a room",
        "serviceType": "PAID",
        "paid": true,
        "payoutChain": "BASE",
        "passwordProtected": false,
        "call": {
          "method": "POST",
          "path": "/quote/device/f7d0d122-…/service/455e8ec1-…"
        },
        "arguments": [
          { "name": "room",  "type": "string",  "required": true,  "description": "Room number" },
          { "name": "floor", "type": "string",  "required": true,  "description": "Floor number" },
          { "name": "celsius","type": "number", "required": false, "description": "Target °C (default 21)" }
        ]
      }
    ]
  }
}`}</Code>
        </Step>
      </Steps>

      <h2>Building your call</h2>
      <ul>
        <li>
          Every service lists its <code>arguments</code>: <code>name</code>,{" "}
          <code>type</code> (<code>string</code> / <code>number</code> /{" "}
          <code>boolean</code>), <code>required</code>, and a human{" "}
          <code>description</code>.
        </li>
        <li>
          Fill matching values into <code>params</code> when you call the
          service.
        </li>
        <li>
          <code>passwordProtected</code> services are listed too — you just also
          need credentials to call them.
        </li>
      </ul>

      <Callout title="Next">
        <DocLink href="/docs/calling">Call a service</DocLink>.
      </Callout>
    </Article>
  );
}
