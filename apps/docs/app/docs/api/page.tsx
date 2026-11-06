import type { Metadata } from "next";
import { Article, Code, H2 } from "../../components";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "0xBS device-controller API: public discovery, the x402 call endpoint, and authenticated owner endpoints for devices and services.",
  alternates: { canonical: "/docs/api" },
};

export default function Page() {
  return (
    <Article
      href="/docs/api"
      title="API reference"
      lead="Public agent endpoints and authenticated owner endpoints."
      headings={["Public", "Owner", "Argument schema"]}
    >
      <p>
        Base URL in examples: <code>{site.apiUrl}</code>
      </p>

      <H2>Public</H2>
      <p>No auth. CORS <code>*</code>.</p>

      <h3>GET /public/devices</h3>
      <p>
        Online catalog. Devices that are connected right now and have at least
        one publicly discoverable service. No argument schemas — use the next
        endpoint for those.
      </p>
      <Code lang="http">{`GET ${site.apiUrl}/public/devices
GET ${site.apiUrl}/public/devices?q=led&limit=20`}</Code>

      <h3>GET /public/device/:deviceId</h3>
      <p>
        Device profile + all services with argument schemas. Never returns
        secrets.
      </p>
      <Code lang="http">{`GET ${site.apiUrl}/public/device/{deviceId}`}</Code>

      <h3>POST /quote/device/:deviceId/service/:serviceId</h3>
      <p>
        Call a service. Free → <code>201</code> result. Paid → <code>402</code>{" "}
        x402 challenge (pay + retry). Protected → also send credentials.
      </p>
      <Code lang="http">{`POST ${site.apiUrl}/quote/device/{deviceId}/service/{serviceId}
Content-Type: application/json

{ "params": { ... }, "username"?: "…", "password"?: "…" }`}</Code>

      <H2>Owner</H2>
      <p>
        These require the owner session. The device <code>GET</code> returns the
        private <code>connectorId</code> only to the authenticated owner.
      </p>
      <table>
        <thead>
          <tr>
            <th>Method + path</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET /devices</code>
            </td>
            <td>List your devices (never returns the key).</td>
          </tr>
          <tr>
            <td>
              <code>POST /devices</code>
            </td>
            <td>Create a device; returns the raw API key once.</td>
          </tr>
          <tr>
            <td>
              <code>GET /devices/:deviceId</code>
            </td>
            <td>
              Device + services + <code>connectorId</code> (owner only).
            </td>
          </tr>
          <tr>
            <td>
              <code>PATCH /devices/:deviceId</code>
            </td>
            <td>Edit name / description.</td>
          </tr>
          <tr>
            <td>
              <code>POST /devices/:deviceId/rotate</code>
            </td>
            <td>Rotate the API key.</td>
          </tr>
          <tr>
            <td>
              <code>DELETE /devices/:deviceId</code>
            </td>
            <td>Delete a device.</td>
          </tr>
          <tr>
            <td>
              <code>
                GET/POST/PATCH/DELETE /devices/:deviceId/services[/:serviceId]
              </code>
            </td>
            <td>Manage services (type, wallet, password, parameters).</td>
          </tr>
        </tbody>
      </table>

      <H2>Argument schema</H2>
      <p>Each service parameter is defined as:</p>
      <Code lang="json">{`{
  "name": "celsius",
  "type": "number",
  "required": true,
  "description": "Target temperature in °C"
}`}</Code>
    </Article>
  );
}
