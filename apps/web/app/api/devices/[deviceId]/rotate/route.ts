import { NextResponse } from "next/server";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import { mintApiKey } from "@/lib/api-key";
import { upsertDeviceCredential } from "@/lib/emqx";

type Ctx = { params: Promise<{ deviceId: string }> };

// POST /api/devices/:deviceId/rotate — mint a new key, returned ONCE.
export async function POST(_request: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { deviceId } = await params;

  const owned = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true, connectorId: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const { raw, apiKeyHash, apiKeyPreview } = mintApiKey();

  await prisma.device.update({
    where: { id: deviceId },
    data: { apiKeyHash, apiKeyPreview },
    select: { id: true },
  });

  try {
    await upsertDeviceCredential(owned.connectorId, raw);
  } catch (err) {
    console.error("[devices] credential rotation failed:", err);
    return NextResponse.json(
      {
        error:
          "Key rotated locally but the MQTT broker was not updated. Rotate again before reflashing the device.",
      },
      { status: 502 },
    );
  }

  // Returned exactly once; the old key is now invalid.
  return NextResponse.json({ apiKey: raw, apiKeyPreview });
}
