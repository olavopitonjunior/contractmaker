import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

const bodySchema = z.object({ locked: z.boolean() });

/**
 * POST /api/forms/[token]/lock  { locked: boolean }
 *
 * Trava (congela) ou destrava o formulário público. Travado = os endpoints de
 * escrita (PATCH do token principal, PATCH do subtoken, uploads de anexo)
 * retornam 403 e as páginas públicas renderizam somente-leitura. Serve pra
 * fixar as informações do negócio num marco, sem tirar o acesso de leitura.
 *
 * Destravar (locked=false) volta lockedAt a null. `[token]` é o SalesForm.token.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido: { locked: boolean }" },
      { status: 400 },
    );
  }
  const { locked } = parsed.data;

  // Cross-org guard.
  const form = await prisma.salesForm.findFirst({
    where: { token: params.token, orgId: ctx.orgId },
    select: { id: true, lockedAt: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }

  const updated = await prisma.salesForm.update({
    where: { id: form.id },
    data: locked
      ? { lockedAt: new Date(), lockedById: ctx.userId }
      : { lockedAt: null, lockedById: null },
    select: { lockedAt: true },
  });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: locked ? "FORM_LOCKED" : "FORM_UNLOCKED",
      result: "SUCCESS",
      resourceType: "SalesForm",
      resource: form.id,
    },
  );

  return NextResponse.json({
    lockedAt: updated.lockedAt ? updated.lockedAt.toISOString() : null,
  });
}
