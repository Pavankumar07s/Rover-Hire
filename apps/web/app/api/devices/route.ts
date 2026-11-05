import { NextResponse } from "next/server";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import { mintApiKey } from "@/lib/api-key";
import {
  upsertDeviceCredential,
  emqxProvisioningEnabled,
} from "@/lib/emqx";

// GET /api/devices — list the current user's devices (never returns the key)
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  return NextResponse.json({ devices });
}

// POST /api/devices — create a device (mints an API key, returned ONCE)
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";

  if (!title) {
    return NextResponse.json(
      { error: "Device name is required" },
      { status: 400 },
    );
  }

  // A device carries only its name/description + a default service type and
  // wallet chain (schema defaults). Password protection and discoverability
  // are set per service, not on the device.
  const { raw, apiKeyHash, apiKeyPreview } = mintApiKey();

  const device = await prisma.device.create({
    data: {
      title,
      description: description || null,
      apiKeyHash,
      apiKeyPreview,
      userId,
    },
    select: {
      id: true,
      connectorId: true,
      title: true,
      description: true,
      apiKeyPreview: true,
      createdAt: true,
      services: { select: { id: true, title: true } },
    },
  });

  try {
    await upsertDeviceCredential(device.connectorId, raw);
  } catch (err) {
    await prisma.device.delete({ where: { id: device.id } }).catch(() => {});
    console.error("[devices] credential provisioning failed:", err);
    return NextResponse.json(
      {
        error: emqxProvisioningEnabled
          ? "Could not register the device with the MQTT broker. Try again."
          : "Could not register the device with the MQTT broker. Set EMQX_API_URL / EMQX_API_KEY / EMQX_API_SECRET.",
      },
      { status: 502 },
    );
  }

  // Raw key shown once. connectorId is owner-only — flash it into firmware.
  return NextResponse.json({ device, apiKey: raw }, { status: 201 });
}
