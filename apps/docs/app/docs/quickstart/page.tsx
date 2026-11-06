import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Article, Code, DocLink } from "../../components";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Quickstart",
  description:
    "Discover a 0xBS device, then call a free or USDC-paid service from any x402 client — the same path Claude uses to actuate hardware.",
  alternates: { canonical: "/docs/quickstart" },
};

export default function Page() {
  return (
    <Article
      href="/docs/quickstart"
      title="Quickstart"
      lead="Discover a device contract, then invoke a service. The same path an agent uses to settle USDC and move hardware."
    >
      <Steps>
        <Step>
          <h3>Discover a device</h3>
          <p>
            Every device has a public <code>deviceId</code>. Ask the API what it
            offers:
          </p>
          <Code lang="bash">{`curl ${site.apiUrl}/public/device/DEVICE_ID`}</Code>
          <p>
            You get the device name, description, and every service with its
            argument schema, whether it is free or paid, and whether it needs a
            password. See{" "}
            <DocLink href="/docs/discovery">Discover devices</DocLink> for the
            full response shape.
          </p>
        </Step>
        <Step>
          <h3>Call a free service</h3>
          <p>Free services return the device result directly — no wallet needed:</p>
          <Code lang="bash">{`curl -X POST \\
  ${site.apiUrl}/quote/device/DEVICE_ID/service/SERVICE_ID \\
  -H "content-type: application/json" \\
  -d '{"params":{"room":"100","floor":"5"}}'`}</Code>
        </Step>
        <Step>
          <h3>Call a paid service (x402)</h3>
          <p>
            Paid services reply <code>402</code> with standard x402
            requirements. Wrap <code>fetch</code> with an x402 adapter and it
            pays + retries automatically:
          </p>
          <Code lang="ts">{`import {
  createSigner, wrapFetchWithPayment, decodeXPaymentResponse,
  type MultiNetworkSigner,
} from "x402-fetch";

const evm = await createSigner("base", process.env.AGENT_EVM_PRIVATE_KEY!);
const svm = await createSigner("solana", process.env.AGENT_SOLANA_PRIVATE_KEY!);
const wallet = { evm, svm } as MultiNetworkSigner;

const fetchWithPay = wrapFetchWithPayment(fetch, wallet, 1_000_000n); // cap 1 USDC

const res = await fetchWithPay(
  "${site.apiUrl}/quote/device/DEVICE_ID/service/SERVICE_ID",
  { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: { room: "100", floor: "5" } }) },
);

const xpr = res.headers.get("x-payment-response");
if (xpr) console.log("settled:", decodeXPaymentResponse(xpr));
console.log(await res.json());`}</Code>
        </Step>
        <Step>
          <h3>Password-protected services</h3>
          <p>
            If discovery shows <code>passwordProtected: true</code>, add the
            credentials the owner gave you:
          </p>
          <Code lang="json">{`{
  "username": "agent-alice",
  "password": "s3cr3t",
  "params": { "room": "100", "floor": "5" }
}`}</Code>
        </Step>
      </Steps>

      <Callout title="Agents">
        Wiring Claude or ChatGPT so a prompt can settle and actuate? See{" "}
        <DocLink href="/docs/agents">Claude &amp; ChatGPT</DocLink>.
      </Callout>
    </Article>
  );
}
