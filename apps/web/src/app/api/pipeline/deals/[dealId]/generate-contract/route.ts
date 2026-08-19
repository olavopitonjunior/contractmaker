import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  generateContractForDeal,
  generateLocacaoContractForDeal,
} from "@/lib/services/contract-generation";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  resolveTemplateOverride,
  TEMPLATE_OVERRIDE_MESSAGE,
} from "@/lib/contracts/template-category";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * Body OPCIONAL. `.catch(() => ({}))` no json e schema não-estrito de
 * propósito: a UI chamava (e ainda chama) esta rota sem body e sem
 * Content-Type — exigir corpo aqui transformaria o botão "Gerar contrato" em
 * 400 pra todo mundo.
 */
const Body = z.object({ templateId: z.string().min(1).optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  // `ctx.userId` é o ator EFETIVO: sob impersonation, o dono do tenant. É ele
  // que tem membership na org (RBAC do `guardDealScope`) e é ele que deve
  // constar como autor do contrato gerado — o super_admin real fica carimbado
  // no AuditLog por `audit()` (metadata `impersonatedBy`).
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    // Deals de locação usam o gerador próprio (template por schemaType +
    // enrichLocacaoData + upsert do LeaseContract). Os asserts de módulo
    // ficam dentro de cada gerador.
    const deal = await prisma.deal.findUnique({
      where: { id: params.dealId },
      select: { kind: true },
    });
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Cross-org + escopo do gerente + CONTRACT_CREATE. Esta rota não tinha
    // checagem de org própria — o guard fecha as duas coisas.
    const denied = await guardDealScope({
      dealId: params.dealId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CONTRACT_CREATE,
    });
    if (denied) return denied;

    // Escolha manual de modelo. Pedido inválido é 400 — NUNCA cai no
    // automático: trocar em silêncio o modelo que o operador escolheu é como o
    // contrato sai errado sem ninguém perceber.
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "templateId inválido" }, { status: 400 });
    }
    let override;
    if (parsed.data.templateId) {
      const resolved = await resolveTemplateOverride({
        templateId: parsed.data.templateId,
        orgId: ctx.orgId,
        dealKind: deal.kind,
      });
      if (!resolved.ok) {
        return NextResponse.json(
          { error: TEMPLATE_OVERRIDE_MESSAGE[resolved.reason] },
          { status: 400 }
        );
      }
      override = resolved.template;
    }

    const generate =
      deal.kind === "locacao"
        ? generateLocacaoContractForDeal
        : generateContractForDeal;
    const result = await generate(params.dealId, ctx.userId, ctx.orgId, {
      template: override,
    });

    // Só auditamos a ESCOLHA: a geração automática já é rastreável pelo
    // Contract criado, mas "por que este contrato saiu com aquele modelo" só
    // se responde se o override ficar registrado.
    if (override) {
      await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
        action: "CONTRACT_GENERATE",
        result: "SUCCESS",
        resource: result.contractId,
        resourceType: "Contract",
        metadata: {
          templateOverrideId: override.id,
          templateName: override.name,
          dealId: params.dealId,
        },
      });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("Generate contract error:", error);
    return NextResponse.json(
      { error: error.message || "Erro ao gerar contrato" },
      { status: 400 }
    );
  }
}
