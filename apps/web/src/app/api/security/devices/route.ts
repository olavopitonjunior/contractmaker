import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { listTrustedDevices } from "@/lib/security/devices";

/**
 * GET /api/security/devices — lista dispositivos confiáveis.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const devices = await listTrustedDevices(ctx.userId);
  return NextResponse.json({
    devices: devices.map((d) => ({
      id: d.id,
      label: d.label,
      lastIpAddress: d.lastIpAddress,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
    })),
  });
}
