import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedDeal } from "@/lib/deals/route-helpers";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

// Exatamente um: usuário da plataforma, ou limpar.
const bodySchema = z.object({
  managerUserId: z.string().min(1).optional(),
  clear: z.boolean().optional(),
});

/**
 * PATCH /api/deals/[dealId]/manager — define/troca/remove o gerente do negócio.
 * Molde do assignee de proposta (api/proposals/[id]/assignee).
 *
 * `clear:true` remove sempre — inclusive com `managerRequired` ligado. O toggle
 * da org governa a CRIAÇÃO de negócio (resolveManagerForCreate), não a gestão
 * de um negócio existente: o admin precisa poder deixar um negócio órfão de
 * propósito (gerente desligado, carteira em transição), e negócio sem gerente
 * simplesmente sai do escopo restrito dos gerentes (dealScopeWhere) e segue
 * visível pra quem tem deal.view.all.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const r = await loadScopedDeal(req, params.dealId);
  if ("fail" in r) return r.fail;
  const { auth, eff, deal } = r;

  // Bearer (serviço da org) passa; sessão exige a permissão de atribuição.
  if (auth.ident.via !== "bearer" && !can(eff, PERMISSION.DEAL_MANAGER_ASSIGN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { managerUserId, clear } = parsed.data;
  const provided = [managerUserId, clear ? "clear" : undefined].filter(
    (v) => v != null
  );
  if (provided.length !== 1) {
    return NextResponse.json(
      { error: "Informe exatamente um: managerUserId ou clear." },
      { status: 400 }
    );
  }

  let next: string | null;
  if (clear) {
    next = null;
  } else {
    // Só membros da org podem ser gerentes (não restringe ao role gerente —
    // mesmo racional do assignee de proposta).
    const member = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: managerUserId!, orgId: auth.org.id } },
      select: { userId: true },
    });
    if (!member) {
      return NextResponse.json(
        { error: "Usuário não é membro desta organização." },
        { status: 400 }
      );
    }
    next = managerUserId!;
  }

  const updated = await prisma.deal.update({
    where: { id: deal.id },
    data: { managerUserId: next },
    select: {
      id: true,
      managerUserId: true,
      manager: { select: { id: true, name: true, email: true } },
    },
  });

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "DEAL_MANAGER_ASSIGN",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: {
        previousManagerUserId: deal.managerUserId,
        managerUserId: updated.managerUserId,
      },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, ...updated });
}
