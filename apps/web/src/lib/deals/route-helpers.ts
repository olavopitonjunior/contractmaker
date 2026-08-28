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
import { getEffectiveUserId } from "@/lib/auth/impersonation";

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

/**
 * Shape lite do contrato — o suficiente pra autorização. A org do contrato vem
 * do DEAL (`deal.pipeline.orgId`): contrato importado tem `templateId = null`,
 * então `template.orgId` não serve como fonte única (ver CLAUDE.md §Schemas
 * críticos). `Contract.dealId` é obrigatório no schema, logo o deal sempre
 * existe; o `template.orgId` fica só como fallback defensivo.
 */
export interface ScopedContractLite {
  id: string;
  dealId: string;
  orgId: string;
  deal: { userId: string; managerUserId: string | null };
}

/**
 * Gêmeo de `loadScopedDeal` pras rotas com raiz em CONTRATO
 * (`/api/contracts/[id]/*`): resolve o contrato, deriva a org pelo deal,
 * aplica cross-org + `canAccessDeal` (404) e a permission opcional (403).
 * Bearer bypassa o scoping por usuário (token é da ORG), como no deal.
 */
export async function loadScopedContract(
  req: NextRequest,
  contractId: string,
  opts?: { permission?: PermissionKey; scope?: string }
): Promise<
  | { fail: NextResponse }
  | {
      auth: ApiAuthSuccess;
      eff: EffectivePermissions;
      contract: ScopedContractLite;
    }
> {
  const auth = await requireApiAuth(req, {
    scope: opts?.scope ?? "contracts:rw",
  });
  if (isAuthFailure(auth)) return { fail: authFailureResponse(auth) };

  const row = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      dealId: true,
      deal: {
        select: {
          userId: true,
          managerUserId: true,
          pipeline: { select: { orgId: true } },
        },
      },
      template: { select: { orgId: true } },
    },
  });

  const notFound = () => ({
    fail: NextResponse.json({ error: "Não encontrado" }, { status: 404 }),
  });

  const orgId = row?.deal?.pipeline?.orgId ?? row?.template?.orgId;
  if (!row || !orgId || orgId !== auth.org.id) return notFound();

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
      ownerUserId: row.deal?.userId ?? "",
      managerUserId: row.deal?.managerUserId ?? null,
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

  return {
    auth,
    eff,
    contract: {
      id: row.id,
      dealId: row.dealId,
      orgId,
      deal: {
        userId: row.deal?.userId ?? "",
        managerUserId: row.deal?.managerUserId ?? null,
      },
    },
  };
}

/**
 * Gate de escopo pra rotas que resolvem auth por conta própria — session-only
 * (`auth()` + `getUserOrg`) ou `requireAuth` de lib/auth/context. NÃO substitui
 * a autenticação nem o cross-org check do caller: é ACRESCENTADO depois deles.
 *
 * Devolve a NextResponse de erro (404 fora do escopo, 403 sem a permission) ou
 * `null` pra seguir o fluxo. `via: "bearer"` bypassa o scoping por usuário
 * (token é da ORG), espelhando `loadScopedDeal`.
 */
export async function guardDealScope(params: {
  dealId: string;
  userId: string;
  orgId: string;
  via?: string;
  permission?: PermissionKey;
}): Promise<NextResponse | null> {
  const { dealId, userId, orgId, via, permission } = params;
  if (via === "bearer") return null;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      userId: true,
      managerUserId: true,
      pipeline: { select: { orgId: true } },
    },
  });
  const notFound = () =>
    NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  // Cross-org: só compara quando o pipeline veio (o caller já validou a org por
  // conta própria; aqui é defesa em profundidade, não a checagem primária).
  if (!deal || (deal.pipeline?.orgId && deal.pipeline.orgId !== orgId)) {
    return notFound();
  }

  // Ator EFETIVO: sob impersonation, `getUserOrg` já devolveu a org IMPERSONADA
  // (lib/auth/user-org.ts), mas o `userId` que chega aqui é o do super_admin real —
  // que não tem OrgMembership nesse tenant. Sem esta linha, getEffectivePermissions
  // volta null e o guard responde 404 em toda rota que usa este helper, enquanto a
  // PÁGINA (que resolve getEffectiveUserId) abre normalmente. Fora da impersonation
  // o helper devolve o próprio userId — comportamento inalterado.
  const effUserId = await getEffectiveUserId(userId);
  const eff = await getEffectivePermissions(effUserId, orgId);
  if (
    !eff ||
    !canAccessDeal({
      effective: eff,
      ownerUserId: deal.userId,
      managerUserId: deal.managerUserId,
    })
  ) {
    return notFound();
  }

  if (permission && !can(eff, permission)) {
    return NextResponse.json(
      { error: "PERMISSION_DENIED", permission },
      { status: 403 }
    );
  }

  return null;
}

/**
 * Versão do `guardDealScope` ancorada no CONTRATO — pras rotas
 * `/api/contracts/[id]/*` que não usam `requireApiAuth`.
 */
export async function guardContractScope(params: {
  contractId: string;
  userId: string;
  orgId: string;
  via?: string;
  permission?: PermissionKey;
}): Promise<NextResponse | null> {
  const { contractId, userId, orgId, via, permission } = params;
  if (via === "bearer") return null;

  const row = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      deal: {
        select: {
          userId: true,
          managerUserId: true,
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  const notFound = () =>
    NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  if (!row) return notFound();
  const contractOrgId = row.deal?.pipeline?.orgId;
  if (contractOrgId && contractOrgId !== orgId) return notFound();

  // Ator EFETIVO: sob impersonation, `getUserOrg` já devolveu a org IMPERSONADA
  // (lib/auth/user-org.ts), mas o `userId` que chega aqui é o do super_admin real —
  // que não tem OrgMembership nesse tenant. Sem esta linha, getEffectivePermissions
  // volta null e o guard responde 404 em toda rota que usa este helper, enquanto a
  // PÁGINA (que resolve getEffectiveUserId) abre normalmente. Fora da impersonation
  // o helper devolve o próprio userId — comportamento inalterado.
  const effUserId = await getEffectiveUserId(userId);
  const eff = await getEffectivePermissions(effUserId, orgId);
  if (
    !eff ||
    !canAccessDeal({
      effective: eff,
      ownerUserId: row.deal?.userId ?? "",
      managerUserId: row.deal?.managerUserId ?? null,
    })
  ) {
    return notFound();
  }

  if (permission && !can(eff, permission)) {
    return NextResponse.json(
      { error: "PERMISSION_DENIED", permission },
      { status: 403 }
    );
  }

  return null;
}
