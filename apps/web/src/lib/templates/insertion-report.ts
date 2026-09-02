// Tipos e utilitários PUROS do relatório do passe de IA (client-safe).
//
// `ai-placeholder-insertion.ts` importa Anthropic e Google Docs; a tela de
// revisão (`TemplateReviewClient`, client component) precisa ler o relatório
// sem puxar nada disso para o bundle. O que a tela e o servidor compartilham
// mora aqui.
import { sanitizePii } from "@/lib/ingestion/pii";

export interface InsertedToken {
  token: string;
  trecho: string;
  /** Em blocos multi-parágrafo: parágrafos do trecho que NÃO puderam ser
   *  removidos com segurança (ambíguos no doc) e ficaram pra revisão manual. */
  leftoverParagraphs?: string[];
}

export type SkipReason =
  // Antes do batch — decididos no texto plano.
  | "ambiguous"
  | "not-found"
  | "unknown-token"
  | "already-tokenized"
  // Depois do batch — decididos pela resposta da API e pela releitura.
  /** O Google recusou o lote inteiro (nada mudou no Doc). */
  | "batch-failed"
  /** A API casou 0 ocorrências: o texto plano mentiu (formatação partindo o trecho). */
  | "replace-noop"
  /** A API casou MAIS de uma vez: o token entrou em lugar que ninguém examinou (cabeçalho/rodapé). */
  | "over-matched"
  /**
   * Um parágrafo do bloco foi APAGADO em mais de um lugar. É o caso destrutivo:
   * o Doc perdeu conteúdo fora do trecho revisado. `paragraph` diz qual.
   */
  | "over-removed"
  /** A API disse que trocou, mas a releitura não mostra o token (ou ainda mostra o trecho). */
  | "verify-failed"
  /** Não deu para reler o Doc — e "não sei" não é "deu certo". */
  | "verify-unavailable";

export interface SkippedToken {
  token: string;
  trecho: string;
  reason: SkipReason;
  /** Em `over-removed`: o parágrafo do bloco que foi apagado além do esperado. */
  paragraph?: string;
}

/**
 * Token do catálogo que NÃO está confirmado no documento, com o porquê.
 * `reason` é o motivo do passe quando a IA propôs um trecho e o passe recusou
 * (aí `trecho` diz qual, já mascarado), ou `no-mapping` quando a IA não propôs
 * nada para esse token. O operador age sobre isto; `token` sozinho só dizia
 * "falta".
 */
export interface UnmappedToken {
  token: string;
  reason: SkipReason | "no-mapping";
  /** Trecho que a IA propôs, MASCARADO (`maskForReport`). */
  trecho?: string;
}

/**
 * Tudo que entra no relatório passa por aqui: o relatório vai para
 * `ContractTemplate.draftReport` (jsonb) e é renderizado na revisão — antes,
 * CPF, agência e conta do contrato-fonte eram gravados crus e exibidos. Só
 * cobre PII com detector determinístico (documentos, dados bancários, CEP,
 * telefone, e-mail); nome e endereço não têm detector sem entidade externa,
 * e é por isso que o Doc continua sendo a fonte, não o relatório.
 */
export function maskForReport(text: string): string {
  return sanitizePii(text).text;
}

export interface InsertionReport {
  /** Tokens CONFIRMADOS no documento após o batch (não "enviados"). */
  inserted: InsertedToken[];
  skippedAmbiguous: SkippedToken[];
  /**
   * Tokens do catálogo ainda não confirmados no doc, com motivo. Relatórios
   * gravados antes de 2026-09-02 têm `string[]` aqui — quem lê aceita as duas
   * formas (`readNotMapped`).
   */
  notMapped: UnmappedToken[];
  /** Tokens obrigatórios ainda ausentes no doc após o pass. */
  missingRequired: string[];
  ranAt: string;
}

/**
 * Lê `notMapped` de um relatório gravado, tolerando o formato antigo
 * (`string[]`, sem motivo) e JSON malformado (→ []).
 */
export function readNotMapped(raw: unknown): UnmappedToken[] {
  if (!Array.isArray(raw)) return [];
  const out: UnmappedToken[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ token: item, reason: "no-mapping" });
    } else if (item && typeof item === "object" && typeof (item as { token?: unknown }).token === "string") {
      const o = item as { token: string; reason?: unknown; trecho?: unknown };
      out.push({
        token: o.token,
        reason: typeof o.reason === "string" ? (o.reason as UnmappedToken["reason"]) : "no-mapping",
        ...(typeof o.trecho === "string" ? { trecho: o.trecho } : {}),
      });
    }
  }
  return out;
}
