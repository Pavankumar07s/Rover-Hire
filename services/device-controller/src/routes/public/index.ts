import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "@0xBs/db";
import { toParamDefs } from "../../lib/params.js";
import { connectedIdentities, isDeviceOnline, isOnlineInSet } from "../../lib/presence.js";
import { rateLimit } from "../../lib/rate-limit.js";

// ── Public discovery router ─────────────────────────────────────────────────
// UNAUTHENTICATED, CORS `*`. This is the surface agents (ChatGPT / Claude / any
// x402 client) use to LEARN how to call a device. It is deliberately read-only
// and leaks nothing sensitive:
//   • NEVER returns `connectorId` (the private MQTT transport identity)
//   • NEVER returns the API key / hash
//   • NEVER returns wallet payout addresses or password hashes
// It exposes only what an agent needs to construct a call: the public device
// id, human name/description, and each service's callable contract (id, type,
// whether it needs a password, and its argument schema).
const publicRouter: ExpressRouter = Router();

const CATALOG_LIMIT_DEFAULT = 50;
const CATALOG_LIMIT_MAX = 100;

function toArguments(stored: unknown) {
  return toParamDefs(stored).map((p) => ({
    name: p.name,
    type: p.type, // "string" | "number" | "boolean"
    required: p.required,
    description: p.description ?? null,
  }));
}

function serviceSummary(deviceId: string, s: {
  id: string;
  title: string | null;
  description: string | null;
  serviceType: "FREE" | "PAID";
  walletChain: "BASE" | "SOLANA";
  passwordProtected: boolean;
  parameters: unknown;
  includeArguments: boolean;
}) {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    serviceType: s.serviceType,
    paid: s.serviceType === "PAID",
    payoutChain: s.walletChain,
    passwordProtected: s.passwordProtected,
    call: {
      method: "POST" as const,
      path: `/quote/device/${deviceId}/service/${s.id}`,
    },
    ...(s.includeArguments ? { arguments: toArguments(s.parameters) } : {}),
  };
}

function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return CATALOG_LIMIT_DEFAULT;
  return Math.min(n, CATALOG_LIMIT_MAX);
}

// GET /public/devices
//
// Online catalog for agents that do not already have a deviceId. Only devices
// with at least one globallyDiscoverable service, and only those currently
// connected (or recently seen). Service argument schemas are omitted here —
// call GET /public/device/:id for the full contract before invoking.
publicRouter.get(
  "/devices",
  rateLimit({ windowMs: 60_000, max: 30 }),
  async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const limit = parseLimit(req.query.limit);

    const rows = await prisma.device.findMany({
      where: {
        services: { some: { globallyDiscoverable: true } },
      },
      select: {
        id: true,
        title: true,
        description: true,
        connectorId: true,
        services: {
          where: { globallyDiscoverable: true },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            description: true,
            serviceType: true,
            walletChain: true,
            passwordProtected: true,
          },
        },
      },
    });

    const connected = await connectedIdentities();
    const online = rows.filter((d) => isOnlineInSet(d.connectorId, connected));

    const matched = q
      ? online.filter((d) => {
          const hay = [
            d.title,
            d.description,
            ...d.services.map((s) => s.title),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : online;

    const devices = matched.slice(0, limit).map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      online: true,
      services: d.services.map((s) =>
        serviceSummary(d.id, { ...s, parameters: [], includeArguments: false }),
      ),
    }));

    res.setHeader("Cache-Control", "public, max-age=5");
    return res.json({
      devices,
      count: devices.length,
      truncated: matched.length > devices.length,
    });
  },
);

// GET /public/device/:deviceId
//
// Returns the device's public profile and its globally-discoverable services.
// Password-protected services are still listed when discoverable — flagged so
// the agent knows it must supply access credentials to call them.
publicRouter.get("/device/:deviceId", async (req, res) => {
  const { deviceId } = req.params as { deviceId: string };

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      title: true,
      description: true,
      connectorId: true, // used only for presence; never returned
      services: {
        where: { globallyDiscoverable: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          serviceType: true, // FREE | PAID
          walletChain: true, // BASE | SOLANA (payout family; not the wallet)
          passwordProtected: true,
          parameters: true,
        },
      },
    },
  });

  if (!device) {
    return res.status(404).json({ error: "Device not found" });
  }

  const online = await isDeviceOnline(device.connectorId);

  res.setHeader("Cache-Control", "public, max-age=15");

  return res.json({
    device: {
      id: device.id,
      title: device.title,
      description: device.description,
      online,
      services: device.services.map((s) =>
        serviceSummary(device.id, { ...s, includeArguments: true }),
      ),
    },
  });
});

export default publicRouter;
