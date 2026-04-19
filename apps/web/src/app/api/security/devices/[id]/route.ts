import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { revokeDevice } from "@/lib/security/devices";
import { audit } from "@/lib/security/audit";

/**
 * DELETE /api/security/devices/[id] — revoga um trusted device.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  await revokeDevice(id, ctx.userId);
  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "TRUSTED_DEVICE_REVOKED",
      result: "SUCCESS",
      resourceType: "trusted_device",
      resource: `trusted_device:${id}`,
    }
  );

  return NextResponse.json({ ok: true });
}
