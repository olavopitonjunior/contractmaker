/**
 * Upload de documentos pelo LEAD na página pública da proposta (`/p/[token]`).
 *
 * A página pública já existe (inteiro teor do Aceite via WhatsApp); o que
 * entra aqui é a regra de QUANDO a proposta aceita documentos vindos de fora e
 * PARA QUEM o lead pode dizer que o documento é. Fonte única para a página, o
 * handshake do Blob e o `/finalize` — divergir os três oferece upload numa
 * proposta cancelada ou recusa o que a página acabou de convidar.
 *
 * Decisões (épico 2026-09):
 *  - Só locação, e só com a feature `locacao.credito` ligada na org (a mesma
 *    da seção "Documentos por parte" que recebe esses arquivos).
 *  - Aceita enquanto a proposta está viva para o lead: fora dos status que
 *    bloqueiam o link público, fora dos terminais (exceto `completa` — o lead
 *    aceitou e a imobiliária ainda vai converter; é justamente a hora de
 *    juntar documentos) e dentro da validade.
 *  - O fiador NÃO ganha link próprio (decisão do Olavo): o lead pode subir os
 *    documentos do fiador dele pela própria página.
 */

import { prisma } from "@/lib/db/prisma";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import type { Assignment } from "@/lib/forms/extracted-to-form";
import { parseProposalAssignment } from "./attachment-assignment";
import {
  PUBLIC_LINK_BLOCKED_STATUSES,
  SIGNED_OR_LATER_STATUSES,
  TERMINAL_STATUSES,
} from "./status-sets";

export type PublicUploadDenial =
  | "not_found"
  | "blocked"
  | "closed"
  | "expired"
  | "kind"
  | "feature_off";

export interface PublicUploadGateInput {
  status: string;
  kind: string | null | undefined;
  validUntil: Date | null | undefined;
}

/**
 * Regra pura (sem banco): a proposta aceita documentos do lead agora?
 * `expired` segue a mesma conta da página pública: status `expirada`, ou data
 * vencida enquanto ainda se espera manifestação.
 */
export function evaluatePublicUploadGate(
  p: PublicUploadGateInput,
  now: Date = new Date()
): { ok: true } | { ok: false; reason: Exclude<PublicUploadDenial, "not_found" | "feature_off"> } {
  if (PUBLIC_LINK_BLOCKED_STATUSES.has(p.status)) return { ok: false, reason: "blocked" };
  if (p.status === "expirada") return { ok: false, reason: "expired" };
  if (TERMINAL_STATUSES.has(p.status) && p.status !== "completa") {
    return { ok: false, reason: "closed" };
  }
  if (!SIGNED_OR_LATER_STATUSES.has(p.status) && p.validUntil != null && now > p.validUntil) {
    return { ok: false, reason: "expired" };
  }
  if (p.kind !== "locacao") return { ok: false, reason: "kind" };
  return { ok: true };
}

export async function isPublicUploadFeatureOn(orgId: string): Promise<boolean> {
  const view = await getOrgModules(orgId);
  return isFeatureEnabled(view, FEATURE.LOCACAO_CREDITO);
}

export interface PublicUploadScope {
  proposalId: string;
  orgId: string;
  /** Dono da proposta — destino do sino "cliente enviou documentos". */
  userId: string;
  status: string;
  dataJson: Record<string, unknown>;
}

export type PublicUploadResolution =
  | { ok: true; scope: PublicUploadScope }
  | { ok: false; reason: PublicUploadDenial };

/** Resolve o token e aplica o gate completo (status + kind + validade + feature). */
export async function resolvePublicUploadScope(token: string): Promise<PublicUploadResolution> {
  const proposal = await prisma.proposal.findUnique({
    where: { token },
    select: {
      id: true,
      orgId: true,
      userId: true,
      status: true,
      kind: true,
      validUntil: true,
      dataJson: true,
    },
  });
  if (!proposal) return { ok: false, reason: "not_found" };
  const gate = evaluatePublicUploadGate(proposal);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  if (!(await isPublicUploadFeatureOn(proposal.orgId))) return { ok: false, reason: "feature_off" };
  return {
    ok: true,
    scope: {
      proposalId: proposal.id,
      orgId: proposal.orgId,
      userId: proposal.userId,
      status: proposal.status,
      dataJson: (proposal.dataJson ?? {}) as Record<string, unknown>,
    },
  };
}

/** HTTP status por motivo — 404 genérico para token inválido (não vaza existência). */
export function publicUploadDenialStatus(reason: PublicUploadDenial): number {
  return reason === "not_found" ? 404 : 403;
}

export const PUBLIC_UPLOAD_DENIAL_MESSAGE: Record<PublicUploadDenial, string> = {
  not_found: "Proposta não encontrada",
  blocked: "Esta proposta não está disponível",
  closed: "Esta proposta já foi encerrada e não recebe mais documentos",
  expired: "Esta proposta expirou e não recebe mais documentos",
  kind: "Esta proposta não recebe documentos por aqui",
  feature_off: "O envio de documentos não está habilitado para esta proposta",
};

export interface PublicPartyOption {
  /** `kind:index` — mesmo formato do seletor interno. */
  value: string;
  label: string;
}

export const DEFAULT_PUBLIC_ASSIGNMENT: Assignment = { kind: "locatario", index: 0 };

function partyName(p: unknown): string {
  const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  const n = typeof o.nome === "string" ? o.nome.trim() : "";
  const r = typeof o.razao_social === "string" ? o.razao_social.trim() : "";
  return n || r;
}

/**
 * "De quem é o documento" na página do lead — vocabulário do cliente, não da
 * imobiliária: locatário(s), cônjuge, fiador (quando a garantia é fiança) e
 * "outro". Locador e imóvel ficam de fora: são da imobiliária.
 */
export function publicUploadPartyOptions(dataJson: Record<string, unknown>): PublicPartyOption[] {
  const locatarios = Array.isArray(dataJson.locatarios) ? dataJson.locatarios : [];
  const count = Math.max(1, locatarios.length);
  const options: PublicPartyOption[] = [];
  for (let i = 0; i < count; i++) {
    const nome = partyName(locatarios[i]);
    const base = count > 1 ? `Locatário ${i + 1}` : "Locatário";
    options.push({ value: `locatario:${i}`, label: nome ? `${base} — ${nome}` : base });
  }
  for (let i = 0; i < count; i++) {
    options.push({
      value: `conjuge_locatario:${i}`,
      label: count > 1 ? `Cônjuge do locatário ${i + 1}` : "Cônjuge do locatário",
    });
  }
  const garantia =
    dataJson.garantia && typeof dataJson.garantia === "object"
      ? (dataJson.garantia as Record<string, unknown>)
      : {};
  if (garantia.tipo === "fiador") {
    const fiadorNome = partyName(garantia.fiador);
    options.push({ value: "fiador:0", label: fiadorNome ? `Fiador — ${fiadorNome}` : "Fiador" });
    options.push({ value: "conjuge_fiador:0", label: "Cônjuge do fiador" });
  }
  options.push({ value: "outro:0", label: "Outro documento" });
  return options;
}

/**
 * Atribuição vinda do lead: tem de ser válida para locação E estar entre as
 * opções oferecidas nesta proposta; qualquer outra coisa cai no locatário 1
 * (o corretor reatribui na tela interna). Nunca 400: o lead não tem como
 * "consertar" um payload.
 */
export function parsePublicAssignment(
  raw: unknown,
  dataJson: Record<string, unknown>
): Assignment {
  const parsed = parseProposalAssignment(raw, "locacao");
  if (!parsed) return DEFAULT_PUBLIC_ASSIGNMENT;
  const allowed = new Set(publicUploadPartyOptions(dataJson).map((o) => o.value));
  return allowed.has(`${parsed.kind}:${parsed.index}`) ? parsed : DEFAULT_PUBLIC_ASSIGNMENT;
}

/** Teto de arquivos enviados pelo lead por proposta (R7 do plano). */
export const MAX_PUBLIC_FILES_PER_PROPOSAL = 20;

export const PUBLIC_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export const PUBLIC_UPLOAD_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

/**
 * Prefixo dos uploads do LEAD — separado do da imobiliária
 * (`proposal-attachments/<proposalId>/`). Genérico de propósito: o cliente
 * escolhe o pathname antes de qualquer resposta do servidor e não conhece o
 * id da proposta; o token é segredo e não pode ir para uma URL de blob
 * pública. A posse é provada no `/finalize` (URL ainda não reivindicada).
 */
export const PUBLIC_UPLOAD_BLOB_PREFIX = "proposal-attachments/public/";
