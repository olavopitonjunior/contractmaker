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
  /** Existia no original, mas outra substituição desta passada o consumiu. */
  | "overlapped"
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
export type UnmappedReason =
  | SkipReason
  /** A IA não propôs trecho nenhum para este token. */
  | "no-mapping"
  /** O documento passou do teto do prompt: a IA nunca viu a cauda. */
  | "doc-truncated"
  /** A resposta da IA estourou `max_tokens`: o JSON veio cortado. */
  | "response-truncated"
  /** A resposta da IA não pôde ser lida como JSON (prosa, cerca, nota). */
  | "response-unparsed";

export interface UnmappedToken {
  token: string;
  reason: UnmappedReason | ReverseMergeReason;
  /** Trecho que a IA propôs, MASCARADO (`maskForReport`). */
  trecho?: string;
  /** Valor do gabarito (reverse-merge) para este token, MASCARADO. */
  sourceValue?: string;
  /** Quantas vezes o valor do gabarito aparece no texto (reverse-merge). */
  occurrences?: number;
}

/** Motivos que só o reverse-merge produz (os pós-batch já estão em SkipReason). */
export type ReverseMergeReason = "too-short" | "stopword" | "not-specific";

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
  /**
   * O texto enviado à IA foi cortado em `MAX_PROMPT_CHARS`. Tudo depois disso
   * é invisível para o passe — e o relatório diz isso em vez de listar a cauda
   * como "não mapeado" sem explicação.
   */
  docTruncated?: boolean;
  /** A resposta estourou `max_tokens` (`stop_reason === "max_tokens"`). */
  responseTruncated?: boolean;
  /**
   * A resposta chegou inteira mas não pôde ser lida como JSON (cerca de
   * código com prosa depois, nota citando `{{placeholders}}`…). Falso quando
   * `responseTruncated` já explica. Relatórios anteriores a 02/09/2026 não
   * têm o campo: `undefined` = "não medido", não "parseou bem".
   */
  responseUnparsed?: boolean;
  /**
   * Tokens que a API pôs no Doc em lugar/quantidade que ninguém revisou
   * (`over-matched`/`over-removed`) e que nenhum outro candidato confirmou.
   * Estão no texto e NÃO contam como presentes — quem reler o Doc depois
   * (reconciliação com o gabarito) precisa respeitar isto, senão "está no
   * texto" vira "confirmado" e o motivo some.
   */
  unconfirmed?: string[];
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
      const o2 = item as { sourceValue?: unknown; occurrences?: unknown };
      out.push({
        token: o.token,
        reason: typeof o.reason === "string" ? (o.reason as UnmappedReason) : "no-mapping",
        ...(typeof o.trecho === "string" ? { trecho: o.trecho } : {}),
        ...(typeof o2.sourceValue === "string" ? { sourceValue: o2.sourceValue } : {}),
        ...(typeof o2.occurrences === "number" ? { occurrences: o2.occurrences } : {}),
      });
    }
  }
  return out;
}
