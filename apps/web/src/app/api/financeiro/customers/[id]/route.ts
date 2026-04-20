import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  const customer = await prisma.asaasCustomer.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      charges: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { deal: { select: { id: true, title: true } } },
      },
    },
  });
  if (!customer) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  return NextResponse.json({ customer });
}
