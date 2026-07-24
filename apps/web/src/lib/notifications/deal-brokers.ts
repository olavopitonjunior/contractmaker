/**
 * Resolvedor de destinatários "corretor" de um deal: comissionados do
 * form.dataJson casados com o registry (SplitRecipient kind="commissioner")
 * + corretores explícitos do override do deal (brokerIds).
 *
 * Diferente do matcher do wizard financeiro, aqui rascunhos INATIVOS
 * (pendingFields) contam — um corretor auto-cadastrado no finalize ainda sem
 * PIX deve receber atualizações do processo. Desativação manual (active=false
 * sem pendingFields) É respeitada como opt-out do registry.
 */

import type { SplitRecipient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  normalizeDoc,
  normalizeName,
  type ComissionadoLike,
} from "@/lib/asaas/commissionados-matcher";

export interface BrokerRecipient {
  splitRecipientId: string;
  label: string;
  email: string | null;
  phone: string | null;
  notifyByEmail: boolean;
  notifyByWhatsapp: boolean;
}

function isEligible(r: SplitRecipient): boolean {
  if (r.kind !== "commissioner") return false;
  if (r.notifyOptOut) return false;
  // Ativo OU rascunho pendente. Desativado "de verdade" fica fora.
  return r.active || (r.pendingFields ?? []).length > 0;
}

function toRecipient(r: SplitRecipient): BrokerRecipient {
  return {
    splitRecipientId: r.id,
    label: r.label,
    email: r.email,
    phone: r.phone,
    notifyByEmail: r.notifyByEmail,
    notifyByWhatsapp: r.notifyByWhatsapp,
  };
}

export async function resolveDealBrokers(params: {
  orgId: string;
  formDataJson: unknown;
  /** brokerIds explícitos do Deal.notificationsJson (config resolvida). */
  brokerIds: string[];
}): Promise<BrokerRecipient[]> {
  const { orgId, formDataJson, brokerIds } = params;

  const data = (formDataJson as Record<string, unknown> | null) ?? {};
  const comissao = data.comissao as Record<string, unknown> | undefined;
  const comissionados: ComissionadoLike[] = Array.isArray(
    comissao?.comissionados
  )
    ? (comissao!.comissionados as ComissionadoLike[])
    : [];

  if (comissionados.length === 0 && brokerIds.length === 0) return [];

  const roster = await prisma.splitRecipient.findMany({
    where: { orgId, kind: "commissioner" },
  });

  const byId = new Map(roster.map((r) => [r.id, r]));
  // Mapa por doc preferindo ativos (o dedupe da migration desativou duplicatas
  // — a inativa não pode "roubar" o match da vencedora).
  const byDoc = new Map<string, SplitRecipient>();
  const byName = new Map<string, SplitRecipient>();
  for (const r of [...roster].sort(
    (a, b) => Number(b.active) - Number(a.active)
  )) {
    const doc = normalizeDoc(r.cpfCnpj ?? r.ownerCpfCnpj);
    if (doc.length >= 11 && !byDoc.has(doc)) byDoc.set(doc, r);
    const name = normalizeName(r.label ?? r.ownerName);
    if (name && !byName.has(name)) byName.set(name, r);
  }

  const picked = new Map<string, SplitRecipient>();

  for (const c of comissionados) {
    let match: SplitRecipient | undefined;
    if (c.splitRecipientId) match = byId.get(c.splitRecipientId);
    if (!match) {
      const doc = normalizeDoc(c.cpf || c.cnpj);
      if (doc.length >= 11) match = byDoc.get(doc);
    }
    if (!match) {
      const name = normalizeName(c.nome);
      if (name) match = byName.get(name);
    }
    if (match && isEligible(match)) picked.set(match.id, match);
  }

  for (const id of brokerIds) {
    const r = byId.get(id);
    if (r && isEligible(r)) picked.set(r.id, r);
  }

  return [...picked.values()].map(toRecipient);
}
