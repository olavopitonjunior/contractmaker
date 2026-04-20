import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { cancelChallenge } from "@/lib/security/challenge";

/**
 * DELETE /api/security/challenges/[id] — cancela challenge ativo.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  await cancelChallenge(id, ctx.userId);
  return NextResponse.json({ ok: true });
}
