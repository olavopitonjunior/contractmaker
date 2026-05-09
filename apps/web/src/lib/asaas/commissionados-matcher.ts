/**
 * Matching entre `comissao.comissionados[]` extraídos do CCV/form e
 * `SplitRecipient` cadastrados na org. Match por CPF/CNPJ normalizado;
 * fallback por nome (lowercase + sem diacríticos).
 *
 * O wizard de cobrança consome este matcher pra pré-popular o SplitEditor
 * com linhas hidratadas. Comissionado sem match aparece como linha amarela
 * com CTA "+ Cadastrar destinatário".
 */

import type { SplitRecipient } from "@prisma/client";

export interface ComissionadoLike {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: "fisica" | "juridica";
  email?: string;
  mobile_phone?: string;
  percentual?: number;
  valor?: number;
}

export type MatchSuggestion = "matched" | "create" | "manual";

export interface MatchResult {
  comissionado: ComissionadoLike;
  matchedRecipient: SplitRecipient | null;
  /**
   * `matched` — recipient cadastrado encontrado por CPF/CNPJ ou nome
   * `create` — não há recipient mas há identificador (CPF/CNPJ) → sugerir cadastro inline
   * `manual` — sem identificador suficiente → corretor cadastra à parte
   */
  suggestion: MatchSuggestion;
  matchedBy?: "cpf_cnpj" | "name";
}

function normalizeDoc(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function matchComissionadosToSplitRecipients(
  comissionados: ComissionadoLike[],
  recipients: SplitRecipient[]
): MatchResult[] {
  const byDoc = new Map<string, SplitRecipient>();
  const byName = new Map<string, SplitRecipient>();
  for (const r of recipients) {
    if (!r.active) continue;
    const doc = normalizeDoc(r.cpfCnpj ?? r.ownerCpfCnpj);
    if (doc.length >= 11) {
      byDoc.set(doc, r);
    }
    const name = normalizeName(r.label ?? r.ownerName);
    if (name) byName.set(name, r);
  }

  return comissionados.map((c) => {
    const doc = normalizeDoc(c.cpf || c.cnpj);
    if (doc.length >= 11) {
      const m = byDoc.get(doc);
      if (m) {
        return {
          comissionado: c,
          matchedRecipient: m,
          suggestion: "matched",
          matchedBy: "cpf_cnpj",
        };
      }
    }
    const name = normalizeName(c.nome);
    if (name) {
      const m = byName.get(name);
      if (m) {
        return {
          comissionado: c,
          matchedRecipient: m,
          suggestion: "matched",
          matchedBy: "name",
        };
      }
    }

    const hasIdent = doc.length >= 11 || name.length >= 3;
    return {
      comissionado: c,
      matchedRecipient: null,
      suggestion: hasIdent ? "create" : "manual",
    };
  });
}
