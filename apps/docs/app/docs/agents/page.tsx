import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Article, Code, DocLink, H2 } from "../../components";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Claude & ChatGPT",
  description:
    "Prompt Claude or ChatGPT to discover 0xBS devices, settle USDC over x402, and actuate MCU-class hardware. MCP for Claude; Custom GPT Actions for ChatGPT.",
  alternates: { canonical: "/docs/agents" },
};

export default function Page() {
  return (
    <Article
      href="/docs/agents"
      title="Prompt Claude. Hardware executes."
      lead="A chat model cannot sign a payment. A thin wallet-holding wrapper can. The model issues deviceId, serviceId, and params — settlement and actuation follow."
      headings={[
        "The intended loop",
        "Why a wrapper",
        "Unmetered discovery + free services",
        "Claude — MCP",
        "ChatGPT — Custom GPT Action",
        "Agent frameworks",
      ]}
    >
      <H2>The intended loop</H2>
      <p>
        You type <em>“Move the car forward two seconds”</em> or{" "}
        <em>“Purchase the soil-moisture reading from greenhouse #4.”</em> The
        agent discovers the public contract, presents an x402 client, USDC
        clears on Base (or Solana), and the MCU wrapped function runs. That is
        the product: inference → settlement → GPIO, with no remote in the
        operator&apos;s hand.
      </p>

      <H2>Why a wrapper</H2>
      <p>
        Chat models call HTTP tools. They <strong>cannot sign crypto</strong>.
        Unmetered (FREE) services work with a plain HTTP tool. Paid services
        need a process that holds a funded wallet and performs the x402
        pay-and-retry. The model never sees the private key.
      </p>

      <H2>Unmetered discovery + free services</H2>
      <p>
        Register two HTTP tools / Custom GPT Actions — no wallet:
      </p>
      <ul>
        <li>
          <code>GET {site.apiUrl}/public/device/&#123;deviceId&#125;</code> —
          contract
        </li>
        <li>
          <code>POST {site.apiUrl}/quote/device/&#123;deviceId&#125;/service/&#123;serviceId&#125;</code>{" "}
          — invoke
        </li>
      </ul>

      <H2>Claude — MCP</H2>
      <p>
        Install the 0xBS MCP server locally. Claude Desktop starts it. Ask it to
        create a payment wallet — keys stay on disk at{" "}
        <code>~/.0xbs/wallet.json</code>; Claude only sees public addresses.
        Fund those addresses with USDC, then prompt.
      </p>
      <ol>
        <li>
          Build <code>services/mcp-server</code> (
          <code>npm install && npm run build</code>).
        </li>
        <li>
          Point Claude Desktop at{" "}
          <code>services/mcp-server/dist/index.js</code> (absolute path) in{" "}
          <code>claude_desktop_config.json</code>, then fully quit and reopen
          Claude.
        </li>
        <li>
          In chat: <em>“Create a 0xBS payment wallet and show me the addresses
          to fund.”</em>
        </li>
        <li>
          After funding: <em>“Find online 0xBS devices and move the car
          forward.”</em>
        </li>
      </ol>
      <Code lang="json">{`{
  "mcpServers": {
    "0xbs-devices": {
      "command": "node",
      "args": ["/absolute/path/to/0xbs/services/mcp-server/dist/index.js"]
    }
  }
}`}</Code>
      <p>
        Free services work immediately. Paid services settle from that wallet
        against <code>{site.apiUrl}</code>. Later, <em>“generate a fresh Base
        keypair”</em> or <em>“generate a fresh Solana keypair”</em> rotates only
        that chain. The old address is retired; funds do not move.
      </p>

      <H2>ChatGPT — Custom GPT Action</H2>
      <p>
        Host the same wrapper behind a public URL and register it as an Action.
        The Action backend holds the wallet key and performs the x402 flow; the
        GPT only passes <code>deviceId</code>, <code>serviceId</code>,{" "}
        <code>params</code>.
      </p>

      <H2>Agent frameworks</H2>
      <p>
        Coinbase AgentKit, LangChain/LangGraph, and similar already ship x402
        tools. Give the agent a funded wallet and point its x402 tool at the
        call URL — the model can settle autonomously and drive physical
        services.
      </p>

      <Callout title="Also">
        Machine-readable spec:{" "}
        <DocLink href="/skills.md">skills.md</DocLink>. Operators exposing
        silicon: <DocLink href="/docs/firmware">Firmware SDK</DocLink>.
      </Callout>
    </Article>
  );
}
