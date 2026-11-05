import type { RequestHandler } from "express";
import { prisma } from "@0xBs/db";
import { hashApiKey } from "../lib/api-key.js";

/**
 * Authenticates a device-to-server call.
 *
 * The device must present:
 *  - `:deviceId` in the path,
 *  - `x-api-key` header — the raw key minted for this device,
 *  - `x-user-id` header — the owning user's id.
 *
 * We hash the presented key and require it to match the stored `apiKeyHash`
 * for that device AND user. On success the device id is attached to
 * `res.locals.deviceId` (and `res.locals.userId`).
 */
export const requireDevice: RequestHandler = async (req, res, next) => {
  const { deviceId } = req.params as { deviceId?: string };
  const apiKey = req.header("x-api-key");
  const userId = req.header("x-user-id");

  if (!deviceId) {
    res.status(400).json({ error: "Missing device id" });
    return;
  }
  if (!apiKey) {
    res.status(401).json({ error: "Missing x-api-key header" });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Missing x-user-id header" });
    return;
  }

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true, userId: true, apiKeyHash: true },
  });

  // Same 401 whether the device is missing or the key is wrong — don't leak which.
  if (!device || device.apiKeyHash !== hashApiKey(apiKey)) {
    res.status(401).json({ error: "Invalid device credentials" });
    return;
  }

  res.locals.deviceId = device.id;
  res.locals.userId = device.userId;
  next();
};
