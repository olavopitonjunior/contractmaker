import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { appendEvent, serializeRequest } from "@/lib/newton/requests";
import { newtonDisabledResponse } from "@/lib/newton/gate";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION, type PermissionKey } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

/**
 * Pedidos ancorados num Deal — registro do que falta para o contrato.
 *
 * Desde 2026-07-25 o Newton NÃO cobra mais informação por conta própria: o cron
 * de sweep (re-cobrança horária) foi removido e a criação do pedido não dispara
 * turn no sidecar. O inbox virou anotação interna da negociadora; quem for atrás
 * da informação é uma pessoa. O Newton só age quando chamado direto com @ no
 * grupo (hoje: criar formulário de negócio).
 *
 * GET  /api/deals/:dealId/newton-requests        — lista (UI do negócio)
 * POST /api/deals/:dealId/newton-requests        — registra o pedido (não dispara nada)
 */

const createSchema = z.object({
  ask: z.string().trim().min(3).max(2000),
  targetType: z.enum(["contact", "group"]),
  // contact: phone E.164 sem '+'. group: opcional (Newton resolve o JID depois).
  targetRef: z.string().trim().max(64).optional(),
  targetLabel: z.string().trim().max(120).optional(),
  priority: z.enum(["normal", "high"]).default("normal"),
  dueAt: z.string().datetime().optional(),
});

/** Resolve a org do deal e garante que pertence à org do caller. */
async function loadDealOrg(
  dealId: string,
  orgId: string,
  scope?: { userId: string; via: string; permission?: PermissionKey }
) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return { error: "Deal not found" as const, status: 404 as const };
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== orgId) return { error: "Forbidden" as const, status: 403 as const };
  // Escopo do gerente (bearer bypassa dentro do guard).
  if (scope) {
    const denied = await guardDealScope({
      dealId,
      userId: scope.userId,
      orgId,
      via: scope.via,
      permission: scope.permission,
    });
    if (denied) {
      return denied.status === 403
        ? { error: "PERMISSION_DENIED" as const, status: 403 as const }
        : { error: "Deal not found" as const, status: 404 as const };
    }
  }
  // O kind decide QUAL feature do Newton vale (vendas.newton vs locacao.newton).
  return { dealOrgId, dealKind: deal.kind };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:r" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const guard = await loadDealOrg(params.dealId, auth.org.id, {
    userId: auth.actor.effectiveUserId,
    via: auth.ident.via,
  });
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const disabled = await newtonDisabledResponse(guard.dealOrgId, guard.dealKind);
  if (disabled) return disabled;

  const requests = await prisma.newtonRequest.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests: requests.map(serializeRequest) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ask, targetType, targetRef, targetLabel, priority, dueAt } = parsed.data;

  // contact exige um telefone; group pode vir sem JID (Newton resolve depois).
  if (targetType === "contact" && !targetRef) {
    return NextResponse.json(
      { error: "targetRef (telefone) obrigatório para targetType=contact" },
      { status: 400 }
    );
  }

  const guard = await loadDealOrg(params.dealId, auth.org.id, {
    userId: auth.actor.effectiveUserId,
    via: auth.ident.via,
    permission: PERMISSION.DEAL_EDIT,
  });
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const disabled = await newtonDisabledResponse(guard.dealOrgId, guard.dealKind);
  if (disabled) return disabled;

  const created = await prisma.newtonRequest.create({
    data: {
      orgId: guard.dealOrgId,
      dealId: params.dealId,
      createdBy: auth.actor.effectiveUserId,
      ask,
      targetType,
      targetRef: targetRef ?? null,
      targetLabel: targetLabel ?? null,
      priority,
      dueAt: dueAt ? new Date(dueAt) : null,
      status: "open",
      eventsJson: appendEvent(null, {
        actor: "negociadora",
        type: "created",
        note: ask,
      }),
    },
  });

  return NextResponse.json(serializeRequest(created), { status: 201 });
}
