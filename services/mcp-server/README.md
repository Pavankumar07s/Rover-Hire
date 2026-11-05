# 0xBS MCP server

Lets an MCP client — Claude Code, Claude Desktop, Codex — discover physical
device services and call them, paying USDC over x402 when a service charges.

The model never sees a private key. Ask Claude to create a wallet; this process
generates keys on disk, returns only public addresses, and signs payments itself.

## Tools

| Tool | Spends money? | Purpose |
|---|---|---|
| `create_wallet` | No | Create a local wallet, or generate a **fresh** Base and/or Solana keypair. Returns addresses only. |
| `import_wallet` | No | Save an existing key on this computer. Never echoed back. |
| `list_online_devices` | No | List devices that are currently online and publicly discoverable. |
| `discover_device` | No | List a device's services with their argument schemas, and whether each is free, paid, or password-protected. |
| `get_service_price` | No | Ask a paid service what one call costs, without paying and without making the device act. |
| `call_device_service` | Yes, if the service is paid | Run the service and return its result, settling payment automatically. |
| `payment_wallet_info` | No | Show which wallets would pay and the per-call ceiling. |
| `is_device_online` | No | Whether the device currently has an MQTT session. |

## Install (Claude Desktop)

1. Clone this repo (or copy `services/mcp-server`) and build once:

```bash
cd services/mcp-server
npm install
npm run build
```

2. Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`
   (use your absolute path) and fully quit Claude (`Cmd+Q`) then reopen:

```json
{
  "mcpServers": {
    "0xbs-devices": {
      "command": "node",
      "args": ["/absolute/path/to/0xbs/services/mcp-server/dist/index.js"]
    }
  }
}
```

3. In a new chat:

> Create a 0xBS payment wallet, then show me the addresses to fund.

Claude calls `create_wallet`. Keys are written to `~/.0xbs/wallet.json` (mode
0600). Only public addresses come back. Send USDC to the matching chain, then
call devices. Free services work before you fund anything.

To rotate later:

> Generate a fresh Base keypair.
> Generate a fresh Solana keypair.

That replaces only that chain. Funds on the old address do not move.

**Claude Code** — already wired via `.mcp.json` at the repo root. Same wallet
file. Verify with `claude mcp list`.

**Codex** — add to `~/.codex/config.toml` with an absolute path:

```toml
[mcp_servers."0xbs-devices"]
command = "node"
args = ["/absolute/path/to/0xbs/services/mcp-server/dist/index.js"]
startup_timeout_sec = 30
```

## Optional .env

Defaults to `https://device-controller.0xbs.org`. A `.env` next to this package
is only needed to override that, set a spend cap, or force a specific key:

```
DEVICE_CONTROLLER_URL=https://device-controller.0xbs.org
MAX_PAYMENT_USDC=0.10
# AGENT_EVM_PRIVATE_KEY=     # optional fallback if ~/.0xbs/wallet.json has no EVM key
# AGENT_SOLANA_PRIVATE_KEY=
```

`.env` is git-ignored. A key in `~/.0xbs/wallet.json` wins for that chain, so a
fresh pair generated in Claude is used immediately. Env is the fallback when
the file has no key for that family.

### Spend limit

`MAX_PAYMENT_USDC` is a hard ceiling on any single automatic payment. A tool call
may pass `maxUsdc` to tighten it, but nothing can raise it past this value.

## Requirements at call time

The device-controller at `DEVICE_CONTROLLER_URL` must be reachable, and the
target device must be connected to the MQTT broker. A device that is powered off
produces `Timed out waiting for device reply (10s)` — that is the hardware being
absent, not a payment or MCP problem. For paid services the wallet needs USDC on
the chain the service settles on.

## A note on stdout

The stdio transport uses stdout for JSON-RPC frames, so anything else written
there corrupts the session. All diagnostics go to stderr, and `dotenv` is loaded
with `quiet: true` because its startup banner would otherwise land on stdout.
