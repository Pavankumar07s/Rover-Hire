import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "@0xBs/db";
import { parseParamDefs, type ParamDef } from "../../lib/params.js";
import {
  isWalletChain,
  normalizeWalletForChain,
  type WalletChain,
} from "../../lib/api-key.js";
import { hashPassword } from "../../lib/password.js";

// Prisma's JSON input type is structural; ParamDef[] is JSON-safe, so we cast
// through this helper to satisfy the generated client types.
const asJson = (defs: ParamDef[]) => defs as unknown as object[];

// Fields returned for a service — never exposes the access password hash.
const SERVICE_SELECT = {
  id: true,
  title: true,
  description: true,
  parameters: true,
  recipientWallet: true,
  walletChain: true,
  serviceType: true,
  passwordProtected: true,
  globallyDiscoverable: true,
  accessUsername: true,
  createdAt: true,
} as const;

// mergeParams so we can read :deviceId from the parent device router.
const serviceRouter: ExpressRouter = Router({ mergeParams: true });

/** Ensure the device exists and belongs to the authenticated user. */
async function assertDeviceOwner(deviceId: string, userId: string) {
  return prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
}

// GET /devices/:deviceId/services
serviceRouter.get("/", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId } = req.params as { deviceId: string };

  const device = await assertDeviceOwner(deviceId, userId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const services = await prisma.service.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    select: SERVICE_SELECT,
  });

  res.json({ services });
});

// Parse the service fields shared by create/update. Returns the data patch to
// apply, or an error string.
//
// - walletChain is a DIRECT per-service field (devices have no wallet). On
//   create it defaults to BASE; on update it only changes when provided.
//   `existingChain` is the service's stored chain, used to validate a wallet
//   when the caller updates the address but not the chain.
// - serviceType is a DIRECT per-service field. On create it defaults to FREE;
//   on update it only changes when provided.
// - passwordProtected / globallyDiscoverable are DIRECT per-service settings.
//   On create they default to false / true; on update they only change when
//   provided. existingProtected / isCreate drive password requirement checks.
type OverrideData = {
  recipientWallet?: string | null;
  walletChain?: WalletChain;
  serviceType?: "FREE" | "PAID";
  passwordProtected?: boolean;
  globallyDiscoverable?: boolean;
  accessUsername?: string | null;
  accessPasswordHash?: string | null;
};

function parseOverrides(
  body: any,
  existingChain: WalletChain | undefined,
  existingProtected: boolean | undefined,
  isCreate: boolean,
): { ok: true; data: OverrideData } | { ok: false; error: string } {
  const data: OverrideData = {};

  // Wallet chain: direct field. Default BASE on create; otherwise only set when
  // provided. Track the effective chain to validate the wallet address.
  let effChain: WalletChain = existingChain ?? "BASE";
  if (body?.walletChain != null) {
    if (!isWalletChain(body.walletChain)) {
      return { ok: false, error: "walletChain must be BASE or SOLANA" };
    }
    data.walletChain = body.walletChain;
    effChain = body.walletChain;
  } else if (isCreate) {
    data.walletChain = "BASE";
    effChain = "BASE";
  }

  if (body?.recipientWallet !== undefined) {
    const w = body.recipientWallet;
    if (typeof w === "string" && w.trim()) {
      const normalized = normalizeWalletForChain(w, effChain);
      if (!normalized) {
        return {
          ok: false,
          error:
            effChain === "SOLANA"
              ? "Recipient wallet must be a valid Solana address (base58)"
              : "Recipient wallet must be a valid Base address (0x…)",
        };
      }
      data.recipientWallet = normalized;
    } else {
      data.recipientWallet = null;
    }
  }

  if (body?.serviceType === "FREE" || body?.serviceType === "PAID") {
    data.serviceType = body.serviceType;
  } else if (isCreate) {
    data.serviceType = "FREE";
  }

  // Direct per-service settings. On create, default to false/true when the
  // caller doesn't specify; on update, leave untouched unless provided.
  if (typeof body?.passwordProtected === "boolean") {
    data.passwordProtected = body.passwordProtected;
  } else if (isCreate) {
    data.passwordProtected = false;
  }

  if (typeof body?.globallyDiscoverable === "boolean") {
    data.globallyDiscoverable = body.globallyDiscoverable;
  } else if (isCreate) {
    data.globallyDiscoverable = true;
  }

  // Effective protection: new value if provided, else the existing stored one.
  const effProtected =
    data.passwordProtected !== undefined
      ? data.passwordProtected
      : (existingProtected ?? false);

  if (body?.accessUsername !== undefined) {
    data.accessUsername =
      typeof body.accessUsername === "string" && body.accessUsername.trim()
        ? body.accessUsername.trim()
        : null;
  }
  if (typeof body?.accessPassword === "string" && body.accessPassword) {
    data.accessPasswordHash = hashPassword(body.accessPassword);
  } else if (body?.accessPassword === null && !effProtected) {
    // Clearing the hash is only allowed when protection is off.
    data.accessPasswordHash = null;
  }

  if (data.passwordProtected === false) {
    data.accessPasswordHash = null;
  }

  // If protection is on and there's no password (neither supplied now nor
  // already stored), reject. On update, `existingProtected === true` implies a
  // stored hash already exists, so only require one on create or when turning
  // protection on for a service that had none.
  if (effProtected && !existingProtected && data.accessPasswordHash == null) {
    return {
      ok: false,
      error: "A password is required for a password-protected service",
    };
  }

  return { ok: true, data };
}

// POST /devices/:deviceId/services — create a service
serviceRouter.post("/", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId } = req.params as { deviceId: string };

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const { title, description, parameters } = req.body ?? {};
  const name = typeof title === "string" ? title.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Service name is required" });
    return;
  }

  const parsed = parseParamDefs(parameters);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const overrides = parseOverrides(req.body, undefined, undefined, true);
  if (!overrides.ok) {
    res.status(400).json({ error: overrides.error });
    return;
  }

  const service = await prisma.service.create({
    data: {
      title: name,
      description:
        typeof description === "string" && description.trim()
          ? description.trim()
          : null,
      parameters: asJson(parsed.defs),
      ...overrides.data,
      deviceId,
      userId,
    },
    select: SERVICE_SELECT,
  });

  res.status(201).json({ service });
});

// GET /devices/:deviceId/services/:serviceId
serviceRouter.get("/:serviceId", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId, serviceId } = req.params as {
    deviceId: string;
    serviceId: string;
  };

  const service = await prisma.service.findFirst({
    where: { id: serviceId, deviceId, userId },
    select: SERVICE_SELECT,
  });

  if (!service) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  res.json({ service });
});

// PATCH /devices/:deviceId/services/:serviceId — update name/description/overrides
serviceRouter.patch("/:serviceId", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId, serviceId } = req.params as {
    deviceId: string;
    serviceId: string;
  };

  const existing = await prisma.service.findFirst({
    where: { id: serviceId, deviceId, userId },
    select: {
      id: true,
      walletChain: true,
      passwordProtected: true,
    },
  });
  if (!existing) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  const { title, description, parameters } = req.body ?? {};
  const data: {
    title?: string;
    description?: string | null;
    parameters?: object[];
    recipientWallet?: string | null;
    walletChain?: WalletChain;
    serviceType?: "FREE" | "PAID";
    passwordProtected?: boolean;
    globallyDiscoverable?: boolean;
    accessUsername?: string | null;
    accessPasswordHash?: string | null;
  } = {};
  if (typeof title === "string" && title.trim()) data.title = title.trim();
  if (typeof description === "string")
    data.description = description.trim() || null;

  if (parameters !== undefined) {
    const parsed = parseParamDefs(parameters);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    data.parameters = asJson(parsed.defs);
  }

  const overrides = parseOverrides(
    req.body,
    existing.walletChain,
    existing.passwordProtected,
    false,
  );
  if (!overrides.ok) {
    res.status(400).json({ error: overrides.error });
    return;
  }
  Object.assign(data, overrides.data);

  const service = await prisma.service.update({
    where: { id: serviceId },
    data,
    select: SERVICE_SELECT,
  });

  res.json({ service });
});

// DELETE /devices/:deviceId/services/:serviceId
serviceRouter.delete("/:serviceId", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId, serviceId } = req.params as {
    deviceId: string;
    serviceId: string;
  };

  const existing = await prisma.service.findFirst({
    where: { id: serviceId, deviceId, userId },
    select: { id: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  await prisma.service.delete({ where: { id: serviceId } });
  res.json({ ok: true });
});

export default serviceRouter;
