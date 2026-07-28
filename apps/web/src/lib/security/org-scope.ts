import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { isDynamicServerError } from "@/lib/auth/user-org";

/**
 * Escopo multitenant deny-by-default para recursos aninhados.
 *
 * Deal não tem orgId direto — o dono é `deal.pipeline.orgId`. Contract e
 * DealAttachment herdam via Deal. O padrão canônico (o mesmo do
 * /api/contracts/[id]/approve) é: carregar o orgId dono do recurso, comparar
 * com a org do ator e responder **404** (não 403) quando não bate, pra não
 * vazar a existência de recursos de outros tenants.
 *
 * Todos os helpers retornam `null` quando o recurso não existe — o caller
 * trata inexistente e cross-org do mesmo jeito (404).
 */

/** orgId dono de um Contract (via deal.pipeline). */
export async function getContractOrgId(
  contractId: string
): Promise<string | null> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { deal: { select: { pipeline: { select: { orgId: true } } } } },
  });
  return contract?.deal?.pipeline?.orgId ?? null;
}

/** orgId dono de um DealAttachment (via deal.pipeline). */
export async function getDealAttachmentOrgId(
  attachmentId: string
): Promise<string | null> {
  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: attachmentId },
    select: { deal: { select: { pipeline: { select: { orgId: true } } } } },
  });
  return attachment?.deal?.pipeline?.orgId ?? null;
}

/** orgId dono de um Deal (via pipeline). */
export async function getDealOrgId(dealId: string): Promise<string | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { pipeline: { select: { orgId: true } } },
  });
  return deal?.pipeline?.orgId ?? null;
}

/** true quando o contrato existe E pertence à org informada. */
export async function contractBelongsToOrg(
  contractId: string,
  orgId: string | null | undefined
): Promise<boolean> {
  if (!orgId) return false;
  const owner = await getContractOrgId(contractId);
  return owner !== null && owner === orgId;
}

/** true quando o attachment existe E pertence à org informada. */
export async function attachmentBelongsToOrg(
  attachmentId: string,
  orgId: string | null | undefined
): Promise<boolean> {
  if (!orgId) return false;
  const owner = await getDealAttachmentOrgId(attachmentId);
  return owner !== null && owner === orgId;
}

/**
 * Org do usuário autenticado (respeita impersonation via getUserOrg).
 * Pra rotas session-only que hoje não resolvem org nenhuma.
 */
export async function resolveUserOrgId(
  userId: string
): Promise<string | null> {
  try {
    const org = await getUserOrg(userId);
    return org?.id ?? null;
  } catch (err) {
    // Não engolir o sinal de dynamic-render do Next (senão prerender estático
    // com org errada). Ver isDynamicServerError.
    if (isDynamicServerError(err)) throw err;
    return null;
  }
}

/** Resposta padrão deny-by-default — 404 genérico sem vazar existência. */
export function orgScopedNotFound(entity = "Recurso"): NextResponse {
  return NextResponse.json(
    { error: `${entity} não encontrado` },
    { status: 404 }
  );
}

/**
 * Gate de role administrativa DENTRO da org (owner/admin) pra telas de
 * diagnóstico/configuração sensível que não são de plataforma. Retorna a
 * org quando ok, ou a NextResponse de erro pronta.
 */
export async function requireOrgAdmin(
  userId: string | undefined | null
): Promise<
  | { ok: true; orgId: string; role: string }
  | { ok: false; res: NextResponse }
> {
  if (!userId) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const org = await getUserOrg(userId).catch((err) => {
    if (isDynamicServerError(err)) throw err;
    return null;
  });
  if (!org) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Sem org" }, { status: 403 }),
    };
  }
  // Impersonation: o ator efetivo é o DONO do tenant (que tem membership), não o
  // super_admin. O fallback "admin" continua como rede de segurança pro caso de
  // o overlay estar ativo e a membership do dono não resolver.
  const effUserId = await getEffectiveUserId(userId);
  const membership = await prisma.orgMembership.findFirst({
    where: { orgId: org.id, userId: effUserId },
    select: { role: true },
  });
  const role = membership?.role ?? "admin";
  if (membership && role !== "owner" && role !== "admin") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Apenas administradores da organização" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, orgId: org.id, role };
}
