import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "@0xBs/db";
import { mintApiKey } from "../../lib/api-key.js";
import {
  upsertDeviceCredential,
  deleteDeviceCredential,
} from "../../lib/emqx.js";
import serviceRouter from "../services/index.js";

const deviceRouter: ExpressRouter = Router();

// GET /devices — list the authenticated user's devices (never returns the key)
deviceRouter.get("/", async (_req, res) => {
  const userId = res.locals.userId as string;

  const devices = await prisma.device.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      apiKeyPreview: true,
      createdAt: true,
      _count: { select: { services: true } },
    },
  });

  res.json({ devices });
});

// POST /devices — create a device (mints an API key, returned ONCE)
deviceRouter.post("/", async (req, res) => {
  const userId = res.locals.userId as string;
  const { title, description } = req.body ?? {};

  const name = typeof title === "string" ? title.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Device name is required" });
    return;
  }

  const { raw, apiKeyHash, apiKeyPreview } = mintApiKey();

  const { connectorId, ...device } = await prisma.device.create({
    data: {
      title: name,
      description:
        typeof description === "string" && description.trim()
          ? description.trim()
          : null,
      apiKeyHash,
      apiKeyPreview,
      userId,
    },
    select: {
      id: true,
      // Needed to provision the broker credential; stripped from the response,
      // since connectorId must never leave this service except to the owner via
      // GET /devices/:deviceId.
      connectorId: true,
      title: true,
      description: true,
      apiKeyPreview: true,
      createdAt: true,
    },
  });

  // Give the device its broker credential. Postgres has to go first — it mints
  // the connectorId the credential is named after — so if the broker rejects us
  // we drop the device again rather than hand back one that can never connect.
  try {
    await upsertDeviceCredential(connectorId, raw);
  } catch (err) {
    await prisma.device.delete({ where: { id: device.id } }).catch(() => {});
    console.error("[devices] credential provisioning failed:", err);
    res.status(502).json({
      error: "Could not register the device with the MQTT broker. Try again.",
    });
    return;
  }

  // The raw key is returned exactly once and never stored or returned again.
  // connectorId is owner-only — flash it into firmware with the key.
  res.status(201).json({ device: { ...device, connectorId }, apiKey: raw });
});

// GET /devices/:deviceId — device details + its services (never returns key)
deviceRouter.get("/:deviceId", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId } = req.params;

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: {
      id: true,
      // The PRIVATE connector id is returned ONLY here, to the authenticated
      // OWNER, so they can flash it into their ESP32 / IoT firmware. It is the
      // MQTT transport identity and must never be shared with agents or exposed
      // on any public route.
      connectorId: true,
      title: true,
      description: true,
      apiKeyPreview: true,
      createdAt: true,
      services: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          parameters: true,
          serviceType: true,
          passwordProtected: true,
          globallyDiscoverable: true,
          createdAt: true,
        },
      },
    },
  });

  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  res.json({ device });
});

// PATCH /devices/:deviceId — edit name + description
deviceRouter.patch("/:deviceId", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId } = req.params;

  const owned = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!owned) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const { title, description } = req.body ?? {};
  const data: {
    title?: string;
    description?: string | null;
  } = {};

  if (typeof title === "string") {
    const t = title.trim();
    if (!t) {
      res.status(400).json({ error: "Device name cannot be empty" });
      return;
    }
    data.title = t;
  }

  if (typeof description === "string") {
    data.description = description.trim() || null;
  }

  const device = await prisma.device.update({
    where: { id: deviceId },
    data,
    select: {
      id: true,
      title: true,
      description: true,
      apiKeyPreview: true,
      createdAt: true,
    },
  });

  res.json({ device });
});

// POST /devices/:deviceId/rotate — mint a new key, returned ONCE
deviceRouter.post("/:deviceId/rotate", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId } = req.params;

  const owned = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true, connectorId: true },
  });
  if (!owned) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  const { raw, apiKeyHash, apiKeyPreview } = mintApiKey();
  await prisma.device.update({
    where: { id: deviceId },
    data: { apiKeyHash, apiKeyPreview },
    select: { id: true },
  });

  // The API key doubles as the broker password, so a rotation has to reach the
  // broker too. If this fails the stored hash is already the new one, leaving
  // the device unable to connect until another rotation succeeds — hence the
  // explicit "rotate again" in the error.
  try {
    await upsertDeviceCredential(owned.connectorId, raw);
  } catch (err) {
    console.error("[devices] credential rotation failed:", err);
    res.status(502).json({
      error:
        "Key rotated locally but the MQTT broker was not updated. Rotate again before reflashing the device.",
    });
    return;
  }

  res.json({ apiKey: raw, apiKeyPreview });
});

// DELETE /devices/:deviceId
deviceRouter.delete("/:deviceId", async (req, res) => {
  const userId = res.locals.userId as string;
  const { deviceId } = req.params;

  const owned = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true, connectorId: true },
  });
  if (!owned) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  // Revoke at the broker first: a credential that outlives its device row is a
  // client that can still connect. If the delete below then fails, the retry is
  // harmless because removing an already-absent credential is a no-op.
  try {
    await deleteDeviceCredential(owned.connectorId);
  } catch (err) {
    console.error("[devices] credential revocation failed:", err);
    res.status(502).json({
      error:
        "Could not revoke the device's MQTT credential, so it was not deleted. Try again.",
    });
    return;
  }

  await prisma.device.delete({ where: { id: deviceId } });
  res.json({ ok: true });
});

// Nested services routes: /devices/:deviceId/services
deviceRouter.use("/:deviceId/services", serviceRouter);

export default deviceRouter;
