import { NextResponse } from "next/server";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import { deleteDeviceCredential } from "@/lib/emqx";

type Ctx = { params: Promise<{ deviceId: string }> };

// GET /api/devices/:deviceId — device details + its services (never returns key)
export async function GET(_request: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { deviceId } = await params;

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: {
      id: true,
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
          recipientWallet: true,
          walletChain: true,
          serviceType: true,
          passwordProtected: true,
          globallyDiscoverable: true,
          accessUsername: true,
          createdAt: true,
        },
      },
    },
  });

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  return NextResponse.json({ device });
}

// PATCH /api/devices/:deviceId — edit name + description
export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { deviceId } = await params;

  const owned = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const data: {
    title?: string;
    description?: string | null;
  } = {};

  if (typeof body?.title === "string") {
    const t = body.title.trim();
    if (!t) {
      return NextResponse.json(
        { error: "Device name cannot be empty" },
        { status: 400 },
      );
    }
    data.title = t;
  }

  if (typeof body?.description === "string") {
    data.description = body.description.trim() || null;
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

  return NextResponse.json({ device });
}

// DELETE /api/devices/:deviceId
export async function DELETE(_request: Request, { params }: Ctx) {
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

  try {
    await deleteDeviceCredential(owned.connectorId);
  } catch (err) {
    console.error("[devices] credential revocation failed:", err);
    return NextResponse.json(
      {
        error:
          "Could not revoke the device's MQTT credential, so it was not deleted. Try again.",
      },
      { status: 502 },
    );
  }

  await prisma.device.delete({ where: { id: deviceId } });
  return NextResponse.json({ ok: true });
}
