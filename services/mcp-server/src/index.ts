#!/usr/bin/env node
/**
 * 0xBS MCP server.
 *
 * Gives an MCP client (Claude Desktop, Claude Code, Codex, …) the ability to
 * discover physical device services and call them, paying with USDC over x402
 * when a service charges. The model never sees the wallet key: it only names a
 * device, a service and some params, and this process signs.
 *
 * stdio transport — stdout carries JSON-RPC frames, so diagnostics go to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEVICE_CONTROLLER_URL,
  MAX_PAYMENT_ATOMIC,
  atomicToUsdc,
  usdcToAtomic,
} from "./config.js";
import {
  callService,
  discoverDevice,
  findService,
  getPaymentOptions,
  listOnlineDevices,
  resetWalletCache,
  walletAddresses,
  type Credentials,
} from "./client.js";
import { registerHederaTools } from "./hedera/tools.js";
import { registerSensorTools } from "./hedera/sensors.js";
import {
  WALLET_PATH,
  createLocalWallet,
  importLocalWallet,
} from "./wallet.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

const fail = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

/** Tool handlers must surface failures as text, not throw, so the model can react. */
async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

const server = new McpServer({ name: "0xbs-devices", version: "1.0.0" });

const deviceIdSchema = z
  .string()
  .describe("Public device id (a UUID). Never the private connectorId.");
const serviceIdSchema = z
  .string()
  .describe("Service id (a UUID) as returned by discover_device.");
const paramsSchema = z
  .record(z.unknown())
  .optional()
  .describe(
    "Arguments for the service, matching the `arguments` schema from discover_device.",
  );

server.registerTool(
  "list_online_devices",
  {
    title: "List online devices",
    description:
      "List 0xBS devices that are currently ONLINE and opted into public discovery. " +
      "Call this when the user has not given a device id, or asks what devices are " +
      "available / online. Returns public ids, names, and a short service list " +
      "(not full argument schemas). Then call discover_device on the one you want " +
      "before call_device_service. Costs nothing. Offline and private devices are omitted.",
    inputSchema: {
      q: z
        .string()
        .optional()
        .describe("Optional search over device and service names, e.g. \"led\" or \"hvac\"."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max devices to return (default 50, max 100)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ q, limit }) =>
    guard(async () => {
      const { devices, count, truncated } = await listOnlineDevices({ q, limit });
      if (count === 0) {
        return ok(
          q
            ? `No online devices matched "${q}". Try a broader search, or wait until a device reconnects.`
            : "No devices are online right now. A device must be connected (board or simulator) and have at least one publicly discoverable service.",
        );
      }

      const blocks = devices.map((d) => {
        const services = d.services
          .map((s) => {
            const flags = [
              s.paid ? `PAID/${s.payoutChain}` : "FREE",
              s.passwordProtected ? "password" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `    - ${s.title} [${s.id}] (${flags})`;
          })
          .join("\n");
        return `- ${d.title ?? "Untitled"} [${d.id}]\n    ${d.description ?? "No description"}\n${services || "    (no public services)"}`;
      });

      return ok(
        `Online devices (${count}${truncated ? ", truncated" : ""}):\n\n` +
          `${blocks.join("\n\n")}\n\n` +
          `Next: discover_device with the public id of the device the user wants.`,
      );
    }),
);

server.registerTool(
  "discover_device",
  {
    title: "Discover a device's services",
    description:
      "List everything a 0xBS device can do: each service's id, whether it is free " +
      "or paid, whether it needs a password, and the exact arguments it accepts. " +
      "Costs nothing and needs no wallet. If you do not have a device id yet, call " +
      "list_online_devices first.",
    inputSchema: { deviceId: deviceIdSchema },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ deviceId }) =>
    guard(async () => {
      const device = await discoverDevice(deviceId);

      const lines = device.services.map((s) => {
        const args = s.arguments
          .map(
            (a) =>
              `${a.name}: ${a.type}${a.required ? "" : "?"}${a.description ? ` (${a.description})` : ""}`,
          )
          .join(", ");
        const flags = [
          s.paid ? `PAID, settles on ${s.payoutChain}` : "FREE",
          s.passwordProtected ? "password required" : null,
        ]
          .filter(Boolean)
          .join("; ");
        return `- ${s.title} [${s.id}] — ${flags}\n    args: ${args || "none"}`;
      });

      return ok(
        `Device: ${device.title} (${device.id})\n` +
          `${device.description ?? "No description"}\n` +
          `Online: ${device.online === true ? "yes" : device.online === false ? "no" : "unknown"}\n\n` +
          `Services (${device.services.length}):\n${lines.join("\n") || "  none"}\n\n` +
          `Raw:\n${JSON.stringify(device, null, 2)}`,
      );
    }),
);

server.registerTool(
  "get_service_price",
  {
    title: "Check what a service charges",
    description:
      "Ask a PAID service what one call would cost, WITHOUT paying and WITHOUT " +
      "making the device do the work. Use this before call_device_service when the " +
      "price matters. Free services return 'free' without contacting the device. " +
      "Prices can depend on the params, so pass the same params you intend to use.",
    inputSchema: {
      deviceId: deviceIdSchema,
      serviceId: serviceIdSchema,
      params: paramsSchema,
      username: z.string().optional(),
      password: z.string().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ deviceId, serviceId, params, username, password }) =>
    guard(async () => {
      const { service } = await findService(deviceId, serviceId);

      // Deliberately short-circuited: for a free service the price probe and a
      // real call are the same unpaid request, which would actuate the hardware.
      if (!service.paid) {
        return ok(
          `"${service.title}" is FREE — no payment, no wallet needed. ` +
            `Call it directly with call_device_service.`,
        );
      }

      const options = await getPaymentOptions(
        deviceId,
        serviceId,
        params ?? {},
        { username, password } as Credentials,
      );

      const priced = options.map(
        (o) =>
          `- ${atomicToUsdc(o.maxAmountRequired)} USDC on ${o.network} → ${o.payTo}`,
      );
      const cheapest = options.reduce((low, o) =>
        BigInt(o.maxAmountRequired) < BigInt(low.maxAmountRequired) ? o : low,
      );
      const withinCap = BigInt(cheapest.maxAmountRequired) <= MAX_PAYMENT_ATOMIC;

      return ok(
        `"${service.title}" costs ${atomicToUsdc(cheapest.maxAmountRequired)} USDC per call.\n\n` +
          `Accepted:\n${priced.join("\n")}\n\n` +
          `Your per-call limit is ${atomicToUsdc(MAX_PAYMENT_ATOMIC)} USDC — ` +
          `${withinCap ? "this call is within it." : "THIS CALL EXCEEDS IT and would be refused."}`,
      );
    }),
);

server.registerTool(
  "call_device_service",
  {
    title: "Call a device service (may spend USDC)",
    description:
      "Run a service on a real physical device and return its result. If the " +
      "service is PAID this SPENDS REAL USDC from the local wallet — one " +
      "settled, irreversible on-chain transfer per call — so confirm with the user " +
      "before calling a paid service, and use get_service_price first if the cost " +
      "is unknown. If there is no wallet yet, call create_wallet first. Free " +
      "services spend nothing. Physical side effects are real and cannot be undone.",
    inputSchema: {
      deviceId: deviceIdSchema,
      serviceId: serviceIdSchema,
      params: paramsSchema,
      username: z
        .string()
        .optional()
        .describe("Access username, for password-protected services."),
      password: z
        .string()
        .optional()
        .describe("Access password, for password-protected services."),
      maxUsdc: z
        .string()
        .optional()
        .describe(
          "Optional tighter spend limit for this call, e.g. \"0.02\". Can only " +
            "lower the server's configured limit, never raise it.",
        ),
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ deviceId, serviceId, params, username, password, maxUsdc }) =>
    guard(async () => {
      const { service, device } = await findService(deviceId, serviceId);
      if (device.online === false) {
        return fail(
          `"${device.title}" looks offline. Reconnect the board (or simulator) before calling, especially for paid services.`,
        );
      }

      const outcome = await callService({
        deviceId,
        serviceId,
        params: params ?? {},
        isPaid: service.paid,
        credentials: { username, password } as Credentials,
        maxAtomic: maxUsdc ? usdcToAtomic(maxUsdc) : undefined,
      });

      const header = outcome.paid
        ? `Paid and called "${service.title}" in ${(outcome.elapsedMs / 1000).toFixed(1)}s.\n` +
          `Settled on ${outcome.settlement?.network} — tx ${outcome.settlement?.transaction}\n` +
          `Paid from ${outcome.settlement?.payer}`
        : `Called "${service.title}" (free) in ${(outcome.elapsedMs / 1000).toFixed(1)}s.`;

      return ok(
        `${header}\n\nDevice result:\n${JSON.stringify(outcome.result, null, 2)}`,
      );
    }),
);

server.registerTool(
  "create_wallet",
  {
    title: "Create or rotate a local payment wallet",
    description:
      "Create or rotate the payment wallet on this computer. Returns ONLY public " +
      "addresses — never private keys. " +
      "First-time setup: call with no args (creates Base + Solana). " +
      "If the user asks for a FRESH / NEW / ROTATE keypair, set fresh=true and " +
      "chains to match: \"base\" (also called EVM / Base / Ethereum), \"solana\", " +
      "or \"both\". Examples: \"generate new Solana keys\" → chains=solana, fresh=true; " +
      "\"new Base wallet\" → chains=base, fresh=true; \"fresh keys\" → chains=both, fresh=true. " +
      "The other chain is kept. The old address for a rotated chain can no longer be used.",
    inputSchema: {
      fresh: z
        .boolean()
        .optional()
        .describe(
          "Generate a brand-new keypair for the selected chain(s). Set true when " +
            "the user asks for fresh / new / rotated keys. Default false (reuse " +
            "existing keys, or create any that are missing).",
        ),
      replace: z
        .boolean()
        .optional()
        .describe("Same as fresh=true. Prefer the fresh argument."),
      chains: z
        .enum(["both", "base", "solana"])
        .optional()
        .describe(
          "Which chain(s) to create or rotate. \"base\" = Base/EVM, \"solana\" = Solana, " +
            "\"both\" = both (default).",
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ fresh, replace, chains }) =>
    guard(async () => {
      const result = createLocalWallet({ fresh, replace, chains });
      resetWalletCache();

      const lines = [
        result.evm ? `Base / EVM: ${result.evm}` : null,
        result.solana ? `Solana: ${result.solana}` : null,
      ].filter(Boolean);

      if (!result.created) {
        return ok(
          `Using the existing wallet.\n\n` +
            `Paying addresses:\n${lines.join("\n")}\n\n` +
            `If the user wants a brand-new Base or Solana keypair, call again with ` +
            `fresh=true and chains="base" | "solana" | "both".`,
        );
      }

      const rotated = result.rotated.length
        ? result.rotated
            .map((c) => (c === "base" ? "Base / EVM" : "Solana"))
            .join(" and ")
        : "wallet";

      return ok(
        `Generated a fresh ${rotated} keypair. Private keys were saved to ${result.path} ` +
          `and are not shown here. Any old address on that chain is retired — funds ` +
          `there do not move.\n\n` +
          `Paying addresses:\n${lines.join("\n")}\n\n` +
          `Ask the user to send USDC to the matching chain:\n` +
          `- Base USDC → Base / EVM address\n` +
          `- Solana USDC → Solana address\n\n` +
          `Keep ${WALLET_PATH} private.`,
      );
    }),
);

server.registerTool(
  "import_wallet",
  {
    title: "Import an existing payment wallet",
    description:
      "Save an existing EVM and/or Solana private key on this computer for paid " +
      "device calls. Store the keys locally and NEVER repeat them in the reply. " +
      "Prefer create_wallet for new users. Confirm with the user before overwriting.",
    inputSchema: {
      evmPrivateKey: z
        .string()
        .optional()
        .describe("0x-prefixed 32-byte hex key for Base / Polygon / other EVM chains."),
      solanaPrivateKey: z
        .string()
        .optional()
        .describe("base58 Solana secret key (32-byte seed or 64-byte keypair)."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async ({ evmPrivateKey, solanaPrivateKey }) =>
    guard(async () => {
      const result = importLocalWallet({ evmPrivateKey, solanaPrivateKey });
      resetWalletCache();
      const lines = [
        result.evm ? `EVM / Base: ${result.evm}` : null,
        result.solana ? `Solana: ${result.solana}` : null,
      ].filter(Boolean);
      return ok(
        `Imported wallet to ${result.path}. Do not repeat the private keys.\n\n` +
          `Paying addresses:\n${lines.join("\n")}\n\n` +
          `Fund these with USDC to call paid services.`,
      );
    }),
);

server.registerTool(
  "payment_wallet_info",
  {
    title: "Show the paying wallet and spend limit",
    description:
      "Report which wallet addresses this server would pay from, and the per-call " +
      "spend ceiling. If no wallet exists, tell the user to run create_wallet. Use " +
      "this to show where to send USDC, or to confirm which wallet a charge came from.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () =>
    guard(async () => {
      const wallets = await walletAddresses();
      const configured = [
        wallets.evm ? `EVM (Base, Polygon, …): ${wallets.evm}` : null,
        wallets.solana ? `Solana: ${wallets.solana}` : null,
      ].filter(Boolean);
      const origin =
        wallets.source === "env"
          ? "Source: environment variables"
          : wallets.source === "file"
            ? `Source: ${wallets.path}`
            : "Source: none";

      return ok(
        `Device controller: ${DEVICE_CONTROLLER_URL}\n` +
          `Per-call limit: ${atomicToUsdc(MAX_PAYMENT_ATOMIC)} USDC\n` +
          `${origin}\n\n` +
          (configured.length
            ? `Paying wallets:\n${configured.join("\n")}\n\n` +
              `Fund these with USDC to call paid services.`
            : `No wallet yet — only FREE services can be called.\n` +
              `Call create_wallet to generate one on this computer. ` +
              `Private keys stay on disk and are never shown to the model.`),
      );
    }),
);

server.registerTool(
  "is_device_online",
  {
    title: "Check whether a device is online",
    description:
      "Return whether the device currently has an MQTT session (physical board or " +
      "simulator). Call this before call_device_service so you do not spend USDC " +
      "on an offline device.",
    inputSchema: { deviceId: deviceIdSchema },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ deviceId }) =>
    guard(async () => {
      const device = await discoverDevice(deviceId);
      const online = device.online === true;
      return ok(
        `"${device.title}" is ${online ? "ONLINE" : "OFFLINE"}.` +
          (online
            ? " Safe to call."
            : " Do not pay for a service until it reconnects."),
      );
    }),
);

registerHederaTools(server);
registerSensorTools(server); // Phase 12; the remote server (http.ts) serves them too since Phase 14

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[0xbs-mcp] ready — device controller ${DEVICE_CONTROLLER_URL}`);
