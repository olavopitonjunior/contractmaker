import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
  type ApiAuthSuccess,
} from "@/lib/api/require-auth";
import {
  getEffectivePermissions,
  canAccessDeal,
  can,
  type EffectivePermissions,
} from "@/lib/security/rbac/check";
import type { PermissionKey } from "@/lib/security/rbac/permissions";

/**
 * Shape lite do deal carregado pelo scope — o suficiente pra autorização e
 * pro roteamento do caller (kind/stage). Callers que precisam do deal inteiro
 * refazem o fetch com o include próprio DEPOIS do gate.
 */
export interface ScopedDealLite {
  id: string;
  userId: string;
  managerUserId: string | null;
  kind: string;
  pipelineId: string;
  stageId: string;
  formId: string | null;
  archivedAt: Date | null;
  pipeline: { orgId: string };
}

/**
 * Carrega um deal já com auth + escopo (org + `canAccessDeal`, que aceita
 * criador OU gerente atribuído quando o caller tem visão restrita). Espelha
 * `loadScopedProposal` (lib/proposals/route-helpers.ts). Retorna 404 (não
 * 403) fora do escopo, pra não vazar existência. Base compartilhada das rotas
 * `/deals/[dealId]/*` — cada caller faz o `can(eff, PERM)` específico depois,
 * ou passa `opts.permission` pra ganhar o 403 padrão daqui.
 *
 * Bearer/Newton: o token é da ORG (age como serviço) — o scoping por usuário
 * NÃO se aplica; permanece só o cross-org check. Sem isso, integrações e o
 * Newton quebrariam ao tocar deals que o dono do token não criou.
 */
export async function loadScopedDeal(
  req: NextRequest,
  dealId: string,
  opts?: { permission?: PermissionKey; scope?: string }
): Promise<
  | { fail: NextResponse }
  | { auth: ApiAuthSuccess; eff: EffectivePermissions; deal: ScopedDealLite }
> {
  const auth = await requireApiAuth(req, { scope: opts?.scope ?? "deals:rw" });
  if (isAuthFailure(auth)) return { fail: authFailureResponse(auth) };

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      userId: true,
      managerUserId: true,
      kind: true,
      pipelineId: true,
      stageId: true,
      formId: true,
      archivedAt: true,
      pipeline: { select: { orgId: true } },
    },
  });
  const notFound = () =>
    ({ fail: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) });

  if (!deal || deal.pipeline.orgId !== auth.org.id) return notFound();

  const eff = await getEffectivePermissions(
    auth.actor.effectiveUserId,
    auth.org.id
  );
  if (!eff) return notFound();

  const isBearer = auth.ident.via === "bearer";
  if (
    !isBearer &&
    !canAccessDeal({
      effective: eff,
      ownerUserId: deal.userId,
      managerUserId: deal.managerUserId,
    })
  ) {
    return notFound();
  }

  if (opts?.permission && !isBearer && !can(eff, opts.permission)) {
    return {
      fail: NextResponse.json(
        { error: "PERMISSION_DENIED", permission: opts.permission },
        { status: 403 }
      ),
    };
  }

  return { auth, eff, deal };
}
