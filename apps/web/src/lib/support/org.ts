/**
 * Resolve o orgId que hospeda a base de conhecimento de suporte.
 *
 * A base é de plataforma (compartilhada por todos os tenants), mas
 * KnowledgeItem.orgId tem FK pra Organization — então o "orgId de plataforma"
 * precisa apontar pra uma org real. Hoje (single-tenant compartilhado) isso é a
 * org compartilhada. Ordem de resolução: SUPPORT_KB_ORG_ID → SHARED_ORG_ID →
 * org mais antiga do banco. Cacheado em memória por processo (o alvo não muda).
 */

import { prisma } from "@/lib/db/prisma";

let cached: string | null = null;

export async function resolveSupportOrgId(): Promise<string> {
  if (cached) return cached;

  const fromEnv = process.env.SUPPORT_KB_ORG_ID || process.env.SHARED_ORG_ID;
  if (fromEnv) {
    cached = fromEnv;
    return fromEnv;
  }

  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!org) {
    throw new Error(
      "Nenhuma organização encontrada para hospedar a base de suporte. Configure SUPPORT_KB_ORG_ID ou SHARED_ORG_ID."
    );
  }
  // Fallback frágil: sem env, seed e runtime podem mirar orgs diferentes se a
  // "mais antiga" divergir entre ambientes. Logamos pra misconfig ficar visível.
  console.warn(
    `[support] SUPPORT_KB_ORG_ID/SHARED_ORG_ID ausentes — usando a org mais antiga (${org.id}) para a base de suporte.`
  );
  cached = org.id;
  return org.id;
}

/** Somente para testes: limpa o cache do orgId resolvido. */
export function __resetSupportOrgCache(): void {
  cached = null;
}
