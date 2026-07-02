import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * DELETE /api/certidoes/share/:token
 * Revokes a share link. Authenticated endpoint — only the user who created
 * the link (or someone in the same org) can revoke it.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const link = await prisma.certidoesShareLink.findUnique({
    where: { token: params.token },
    include: {
      deal: {
        include: {
          form: { select: { orgId: true } },
          // org via pipeline (form pode ser null em deal formless — IDOR)
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (link.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.certidoesShareLink.update({
    where: { id: link.id },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
