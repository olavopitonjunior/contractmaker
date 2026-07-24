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
  /**
   * Origem auditável do comissionado (set pelo backend mapper). Passa-thru
   * pra UI mostrar microcopy "de onde veio esse split". Opcional pra não
   * quebrar callers que sintetizam ComissionadoLike sem essa info.
   */
  source?: "ccv.comissionados" | "ccv.imobiliaria_principal" | "manual";
  /** Match já resolvido pelo backend; UI usa pra mostrar linha verde direto. */
  splitRecipientId?: string | null;
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

export function normalizeDoc(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export function normalizeName(raw: string | null | undefined): string {
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
  // Index direto por ID — usado quando comissionado.splitRecipientId está
  // setado (vinculação explícita pelo form via picker "Selecionar cadastrado"
  // ou pelo botão "Salvar como cadastro reutilizável").
  const byId = new Map<string, SplitRecipient>();
  const byDoc = new Map<string, SplitRecipient>();
  const byName = new Map<string, SplitRecipient>();
  for (const r of recipients) {
    byId.set(r.id, r);
    if (!r.active) continue;
    const doc = normalizeDoc(r.cpfCnpj ?? r.ownerCpfCnpj);
    if (doc.length >= 11) {
      byDoc.set(doc, r);
    }
    const name = normalizeName(r.label ?? r.ownerName);
    if (name) byName.set(name, r);
  }

  return comissionados.map((c) => {
    // Prioridade 1: ID explícito vindo do form. Pula matching heurístico
    // por CPF/CNPJ ou nome — usuário já escolheu manualmente.
    if (c.splitRecipientId) {
      const m = byId.get(c.splitRecipientId);
      if (m && m.active) {
        return {
          comissionado: c,
          matchedRecipient: m,
          suggestion: "matched",
          matchedBy: "cpf_cnpj", // melhor representação genérica do tipo
        };
      }
      // ID inválido ou inativo: cai no fallback heurístico.
    }

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
