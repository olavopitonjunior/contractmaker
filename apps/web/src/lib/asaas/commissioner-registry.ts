/**
 * Registry de corretores (SplitRecipient kind="commissioner") — criação com
 * dedupe e matching compartilhados entre o POST público do form
 * (/api/forms/[token]/commissioners), o auto-cadastro no finalize do form e o
 * resolvedor de destinatários de notificação (lib/notifications).
 *
 * Dedupe em duas camadas:
 *  - Código: match por splitRecipientId > cpfCnpj normalizado > nome
 *    normalizado, considerando TAMBÉM rascunhos inativos (pendingFields) —
 *    o matcher heurístico do wizard (`commissionados-matcher.ts`) só olha
 *    ativos porque o contexto dele é split financeiro.
 *  - Banco: partial unique (orgId, cpfCnpj) WHERE kind='commissioner' AND
 *    active=true (migration 20260724120000). Cobre corrida entre criações
 *    ativas; rascunhos dependem da camada de código.
 */

import { Prisma, type SplitRecipient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizeDoc, normalizeName } from "@/lib/asaas/commissionados-matcher";

export interface CommissionerInput {
  nome?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  tipo_pessoa?: "fisica" | "juridica" | null;
  email?: string | null;
  mobile_phone?: string | null;
  creci?: string | null;
  papel?: string | null;
  splitRecipientId?: string | null;
}

const PAPEIS = new Set([
  "imobiliaria_principal",
  "captador",
  "intermediador",
  "indicador",
  "outro",
]);

function sanitizePapel(raw: string | null | undefined): string | null {
  return raw && PAPEIS.has(raw) ? raw : null;
}

/**
 * Procura um commissioner existente na org pra este comissionado do form.
 * Preferência: id explícito > doc (ativo antes de inativo) > nome exato
 * normalizado (ativo antes de inativo). Retorna null quando não há match.
 */
export async function findCommissionerMatch(
  orgId: string,
  input: CommissionerInput
): Promise<SplitRecipient | null> {
  if (input.splitRecipientId) {
    const byId = await prisma.splitRecipient.findFirst({
      where: { id: input.splitRecipientId, orgId, kind: "commissioner" },
    });
    if (byId) return byId;
  }

  const doc = normalizeDoc(input.cpf || input.cnpj);
  if (doc.length >= 11) {
    const byDoc = await prisma.splitRecipient.findFirst({
      where: { orgId, kind: "commissioner", cpfCnpj: doc },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    });
    if (byDoc) return byDoc;
  }

  const name = normalizeName(input.nome);
  if (name.length >= 3) {
    // Nome não tem coluna normalizada — busca case-insensitive e confere a
    // normalização (diacríticos/espaços) em código. Roster de corretores é
    // pequeno (dezenas), o take cobre com folga.
    const candidates = await prisma.splitRecipient.findMany({
      where: { orgId, kind: "commissioner" },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      take: 200,
    });
    const byName = candidates.find(
      (r) => normalizeName(r.label ?? r.ownerName) === name
    );
    if (byName) return byName;
  }

  return null;
}

export interface CommissionerReceivingExtras {
  pix?: {
    chave: string;
    keyType: string;
    titularNome?: string | null;
    titularCpfCnpj?: string | null;
  };
  banco?: {
    nome?: string | null;
    agencia?: string | null;
    conta?: string | null;
    tipoConta?: string | null;
    titularNome?: string | null;
    titularDoc?: string | null;
  };
}

/**
 * Cria um commissioner novo (sem match prévio). Sem meio de recebimento vira
 * rascunho: pendingFields + active=false (semântica pré-existente do split —
 * dispatcher pula e GET financeiro filtra). Notificações NÃO dependem de
 * active (resolvedor usa kind+notify*).
 */
export async function createCommissioner(
  orgId: string,
  input: CommissionerInput,
  extras?: CommissionerReceivingExtras
): Promise<SplitRecipient> {
  const doc = normalizeDoc(input.cpf || input.cnpj);
  const hasPix = !!extras?.pix?.chave;
  const hasBank = !!(
    extras?.banco?.nome &&
    extras?.banco?.agencia &&
    extras?.banco?.conta
  );
  const recipientType = hasPix ? "pix_external" : "asaas_wallet";
  const pendingFields: string[] = [];
  if (!hasPix && !hasBank) {
    pendingFields.push(recipientType === "pix_external" ? "pixAddressKey" : "walletId");
  }
  const isDraft = pendingFields.length > 0;

  return prisma.splitRecipient.create({
    data: {
      orgId,
      label: (input.nome ?? "").trim() || "Corretor sem nome",
      recipientType,
      walletId: null,
      pixAddressKey: hasPix ? extras!.pix!.chave : null,
      pixKeyType: hasPix ? extras!.pix!.keyType : null,
      ownerName: extras?.pix?.titularNome ?? null,
      ownerCpfCnpj: extras?.pix?.titularCpfCnpj ?? null,
      cpfCnpj: doc.length >= 11 ? doc : null,
      email: input.email?.trim() ? input.email.trim() : null,
      pendingFields,
      active: !isDraft,
      kind: "commissioner",
      tipoPessoa: input.tipo_pessoa ?? null,
      creci: input.creci?.trim() ? input.creci.trim() : null,
      papel: sanitizePapel(input.papel),
      phone: input.mobile_phone?.trim() ? input.mobile_phone.trim() : null,
      bankName: extras?.banco?.nome ?? null,
      bankBranch: extras?.banco?.agencia ?? null,
      bankAccount: extras?.banco?.conta ?? null,
      bankAccountType: extras?.banco?.tipoConta ?? null,
      bankHolderName: extras?.banco?.titularNome ?? null,
      bankHolderDoc: extras?.banco?.titularDoc ?? null,
    },
  });
}

/**
 * Match-ou-cria usado pelo auto-cadastro no finalize do form. Retorna null
 * quando o comissionado não tem identificador suficiente (nem doc nem nome).
 * Nunca lança por corrida: P2002 do partial unique → re-busca e retorna o
 * vencedor.
 */
export async function upsertCommissionerFromFormData(
  orgId: string,
  input: CommissionerInput
): Promise<{ id: string; existed: boolean } | null> {
  const doc = normalizeDoc(input.cpf || input.cnpj);
  const name = normalizeName(input.nome);
  if (doc.length < 11 && name.length < 3) return null;

  const matched = await findCommissionerMatch(orgId, input);
  if (matched) {
    // Backfill leve de contato: cadastro existente sem email/phone ganha o
    // que veio do form (nunca sobrescreve valor já preenchido).
    const patch: Prisma.SplitRecipientUpdateInput = {};
    if (!matched.email && input.email?.trim()) patch.email = input.email.trim();
    if (!matched.phone && input.mobile_phone?.trim()) {
      patch.phone = input.mobile_phone.trim();
    }
    if (!matched.creci && input.creci?.trim()) patch.creci = input.creci.trim();
    if (Object.keys(patch).length > 0) {
      await prisma.splitRecipient
        .update({ where: { id: matched.id }, data: patch })
        .catch(() => undefined);
    }
    return { id: matched.id, existed: true };
  }

  try {
    const created = await createCommissioner(orgId, input);
    return { id: created.id, existed: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await findCommissionerMatch(orgId, input);
      if (winner) return { id: winner.id, existed: true };
    }
    throw err;
  }
}
