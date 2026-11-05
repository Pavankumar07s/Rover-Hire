import { NextResponse } from "next/server";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";

type Ctx = { params: Promise<{ deviceId: string; serviceId: string }> };

// DELETE /api/devices/:deviceId/services/:serviceId
export async function DELETE(_request: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { deviceId, serviceId } = await params;

  const service = await prisma.service.findFirst({
    where: { id: serviceId, deviceId, userId },
    select: { id: true },
  });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  await prisma.service.delete({ where: { id: serviceId } });
  return NextResponse.json({ ok: true });
}
