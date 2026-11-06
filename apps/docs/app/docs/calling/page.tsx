import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Article, Code, DocLink, H2 } from "../../components";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Call a service",
  description:
    "How to call free, USDC-paid (x402), and password-protected 0xBS services with curl, x402-fetch, or x402-axios.",
  alternates: { canonical: "/docs/calling" },
};

export default function Page() {
  return (
    <Article
      href="/docs/calling"
      title="Call a service"
      lead="One endpoint handles free, paid, and password-protected calls."
      headings={[
        "Endpoint",
        "Free services",
        "Paid services (x402)",
        "Password-protected services",
        "Errors",
      ]}
    >
      <H2>Endpoint</H2>
      <Code lang="http">{`POST ${site.apiUrl}/quote/device/{deviceId}/service/{serviceId}
Content-Type: application/json

{ "params": { ...arguments from discovery... } }`}</Code>

      <H2>Free services</H2>
      <p>Returns the device result directly with status 201. No wallet.</p>
      <Code lang="bash">{`curl -X POST \\
  ${site.apiUrl}/quote/device/DEVICE_ID/service/SERVICE_ID \\
  -H "content-type: application/json" \\
  -d '{"params":{"room":"100","floor":"5"}}'`}</Code>

      <H2>Paid services (x402)</H2>
      <p>An unpaid call returns a standard x402 v1 challenge:</p>
      <Code lang="json">{`{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "1000000",
      "resource": "https://…/quote/device/…/service/…",
      "payTo": "0x… / base58…",
      "asset": "0x… / mint…",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USDC", "version": "2" }
    }
  ]
}`}</Code>

      <h3>With x402-fetch</h3>
      <Code lang="ts">{`import { createSigner, wrapFetchWithPayment, decodeXPaymentResponse,
         type MultiNetworkSigner } from "x402-fetch";

const evm = await createSigner("base", process.env.AGENT_EVM_PRIVATE_KEY!);
const svm = await createSigner("solana", process.env.AGENT_SOLANA_PRIVATE_KEY!);
const fetchWithPay = wrapFetchWithPayment(
  fetch, { evm, svm } as MultiNetworkSigner, 1_000_000n);

const res = await fetchWithPay(
  "${site.apiUrl}/quote/device/DEVICE_ID/service/SERVICE_ID",
  { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: { room: "100", floor: "5" } }) });

console.log(await res.json());`}</Code>

      <h3>With x402-axios</h3>
      <Code lang="ts">{`import axios from "axios";
import { withPaymentInterceptor } from "x402-axios";

const client = withPaymentInterceptor(axios.create(), wallet);
const { data } = await client.post(
  "${site.apiUrl}/quote/device/DEVICE_ID/service/SERVICE_ID",
  { params: { room: "100", floor: "5" } });`}</Code>

      <H2>Password-protected services</H2>
      <p>Send credentials in the body:</p>
      <Code lang="json">{`{
  "username": "agent-alice",
  "password": "s3cr3t",
  "params": { "room": "100", "floor": "5" }
}`}</Code>
      <p>Or as headers:</p>
      <Code lang="http">{`x-access-username: agent-alice
x-access-password: s3cr3t`}</Code>
      <p>
        For a paid <em>and</em> protected service, send credentials in the body
        and let the x402 adapter pay — the credentials are preserved across the
        retry.
      </p>

      <H2>Errors</H2>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              402 (with <code>accepts</code>)
            </td>
            <td>payment required</td>
            <td>let the x402 adapter pay + retry</td>
          </tr>
          <tr>
            <td>
              402 <code>&#123; error, detail &#125;</code>
            </td>
            <td>verify/settle failed</td>
            <td>read <code>detail</code> (funds, missing token account)</td>
          </tr>
          <tr>
            <td>401</td>
            <td>password protected</td>
            <td>
              supply valid <code>username</code> + <code>password</code>
            </td>
          </tr>
          <tr>
            <td>404</td>
            <td>device/service not found</td>
            <td>re-run discovery</td>
          </tr>
          <tr>
            <td>409</td>
            <td>paid service has no payout wallet</td>
            <td>owner must fix it</td>
          </tr>
          <tr>
            <td>502</td>
            <td>pricing/processing failed</td>
            <td>retry later</td>
          </tr>
        </tbody>
      </table>

      <Callout title="LLM assistants">
        See <DocLink href="/docs/agents">Claude &amp; ChatGPT</DocLink>.
      </Callout>
    </Article>
  );
}
