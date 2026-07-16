import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

const bodySchema = z.object({
  locked: z.boolean(),
  /**
   * Reabre um formulário JÁ ENVIADO pro cliente voltar a editar pelo link
   * público. Só faz sentido com `locked: false` (reabrir e manter travado seria
   * contraditório), então o handler rejeita a combinação.
   */
  reopen: z.boolean().optional().default(false),
});

/**
 * POST /api/forms/[token]/lock  { locked: boolean, reopen?: boolean }
 *
 * Dois estados do formulário público vivem aqui, porque são a mesma decisão
 * ("esse link ainda aceita/mostra o quê?") e separá-los em rotas distintas
 * deixaria os campos divergirem:
 *
 *  - **locked** — congela ESCRITA. O link segue legível (enquanto o form não
 *    estiver fechado). Serve pra fixar as informações num marco.
 *  - **reopen** — destrava o gate de form ENVIADO. Depois do finalize o link
 *    público para de mostrar qualquer dado pra quem não é da org
 *    (lib/forms/form-gate.ts); reabrir devolve o acesso ao cliente até o
 *    próximo finalize.
 *
 * Reabrir também limpa `lockedAt` (senão o form voltaria a aparecer mas
 * recusaria toda escrita) e `summarySentAt` — o resumo que a org recebeu tem o
 * dado errado, que é justamente o motivo da reabertura, então o próximo
 * finalize deve reenviá-lo. `completedAt` é preservado de propósito: é marco de
 * SLA do funil, não estado de acesso.
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
      { error: "Body inválido: { locked: boolean, reopen?: boolean }" },
      { status: 400 },
    );
  }
  const { locked, reopen } = parsed.data;

  if (reopen && locked) {
    return NextResponse.json(
      { error: "Reabrir exige locked: false — travado e reaberto se anulam" },
      { status: 400 },
    );
  }

  // Cross-org guard.
  const form = await prisma.salesForm.findFirst({
    where: { token: params.token, orgId: ctx.orgId },
    select: { id: true, lockedAt: true, completedAt: true, status: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }

  if (reopen && !form.completedAt && form.status !== "vinculado") {
    return NextResponse.json(
      { error: "Formulário ainda não foi enviado — não há o que reabrir" },
      { status: 409 },
    );
  }

  const updated = await prisma.salesForm.update({
    where: { id: form.id },
    data: reopen
      ? {
          reopenedAt: new Date(),
          lockedAt: null,
          lockedById: null,
          summarySentAt: null,
          // Só o form finalizado pelo cliente volta a "rascunho" — é o que faz
          // o próximo PATCH contar como finalize (fecha o gate e ressincroniza
          // o contrato). Form "vinculado" (import/upload/proposta) MANTÉM o
          // status: ele nunca passou pelo finalize, e rebaixá-lo apagaria o
          // discriminador que o resto do sistema usa pra saber que o deal
          // nasceu de um contrato pronto. Pra ele, `reopenedAt` sozinho já
          // reabre o gate.
          ...(form.status === "completo" ? { status: "rascunho" } : {}),
        }
      : locked
        ? { lockedAt: new Date(), lockedById: ctx.userId }
        : { lockedAt: null, lockedById: null },
    select: { lockedAt: true, reopenedAt: true, status: true },
  });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: reopen ? "FORM_REOPENED" : locked ? "FORM_LOCKED" : "FORM_UNLOCKED",
      result: "SUCCESS",
      resourceType: "SalesForm",
      resource: form.id,
      ...(reopen
        ? {
            metadata: {
              // Preserva a linha do tempo real: o completedAt continua sendo o
              // do envio original.
              completedAt: form.completedAt?.toISOString() ?? null,
              previousStatus: form.status,
            },
          }
        : {}),
    },
  );

  return NextResponse.json({
    lockedAt: updated.lockedAt ? updated.lockedAt.toISOString() : null,
    reopenedAt: updated.reopenedAt ? updated.reopenedAt.toISOString() : null,
    status: updated.status,
  });
}
