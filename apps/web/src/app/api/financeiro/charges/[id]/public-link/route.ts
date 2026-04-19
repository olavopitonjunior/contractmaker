import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { mintPublicLink } from "@/lib/financeiro/publicPage";

/**
 * POST /api/financeiro/charges/[id]/public-link
 * Gera (ou retorna existente) URL pública de pagamento /pay/[token].
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const charge = await prisma.commissionCharge.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!charge) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

  const token = await mintPublicLink(charge.id);
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return NextResponse.json({
    token,
    url: `${baseUrl}/pay/${token}`,
  });
}
