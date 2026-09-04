/**
 * Atribuição "de quem é este documento" nos anexos da PROPOSTA — client-safe.
 *
 * Mesmo contrato do DealAttachment/FormAttachment: o assignment `{kind, index}`
 * vive DENTRO de `extractedData.assignment` (junto de `fields`, `category`,
 * `confidence`, `assignmentPersisted`). Guardar no mesmo lugar é o que faz o
 * convert copiar o anexo verbatim e a aba do negócio reaproveitar
 * `DocumentCard`/`buildLocacaoOptions` sem adaptação.
 *
 * `assignmentPersisted: true` = escolha humana (mover/atribuir); `false`/ausente
 * = sugestão do OCR. Só a escolha humana alimenta o autofill do convert e o
 * editor de pretendentes — paridade com a regra do `DocumentosStep`.
 */

import type { Assignment, DocumentKind } from "@/lib/forms/extracted-to-form";
import { parseAssignment, topKeyForKind, type Esteira } from "@/lib/forms/assignment-scope";

export type ProposalEsteira = Esteira;

export function esteiraForProposalKind(kind: string | null | undefined): ProposalEsteira {
  return kind === "locacao" ? "locacao" : "venda";
}

const VENDA_TOP_KEYS = new Set(["vendedores", "compradores", "imoveis"]);
const LOCACAO_TOP_KEYS = new Set(["locadores", "locatarios", "garantia", "imovel"]);

/**
 * Kinds aceitos na proposta, por esteira (o "outro" é sempre aceito). Decide
 * pela chave de topo em que o kind escreve: um documento de "comprador" não
 * tem onde morar no dataJson de locação, e vice-versa.
 */
export function isKindAllowedForEsteira(kind: string, esteira: ProposalEsteira): boolean {
  if (kind === "outro") return true;
  const top = topKeyForKind(kind, esteira);
  if (!top) return false;
  return esteira === "locacao" ? LOCACAO_TOP_KEYS.has(top) : VENDA_TOP_KEYS.has(top);
}

/**
 * Valida um assignment vindo do cliente contra a esteira da proposta.
 * Devolve null quando inválido (kind desconhecido, fora da esteira, índice
 * absurdo).
 */
export function parseProposalAssignment(raw: unknown, esteira: ProposalEsteira): Assignment | null {
  const parsed = parseAssignment(raw);
  if (!parsed) return null;
  if (!isKindAllowedForEsteira(parsed.kind, esteira)) return null;
  return { kind: parsed.kind as DocumentKind, index: parsed.index };
}

export interface AttachmentExtractedView {
  fields: Record<string, unknown> | null;
  category: string | null;
  confidence: number | null;
  assignment: Assignment;
  assignmentPersisted: boolean;
}

/** Leitura tolerante de `extractedData` (qualquer origem). */
export function readAttachmentExtracted(extractedData: unknown): AttachmentExtractedView {
  const e = (extractedData && typeof extractedData === "object" ? extractedData : {}) as Record<
    string,
    unknown
  >;
  const rawAssignment = parseAssignment(e.assignment);
  return {
    fields: e.fields && typeof e.fields === "object" ? (e.fields as Record<string, unknown>) : null,
    category: typeof e.category === "string" ? e.category : null,
    confidence: typeof e.confidence === "number" ? e.confidence : null,
    assignment: rawAssignment
      ? { kind: rawAssignment.kind as DocumentKind, index: rawAssignment.index }
      : { kind: "outro", index: 0 },
    assignmentPersisted: e.assignmentPersisted === true,
  };
}

/** Snapshot mínimo das partes da proposta para o seletor/sugestão de slot. */
export interface ProposalPartiesSnapshot {
  vendedores: Array<Record<string, unknown>>;
  compradores: Array<Record<string, unknown>>;
  locadores: Array<Record<string, unknown>>;
  locatarios: Array<Record<string, unknown>>;
  /** Venda: `imoveis[]` (plural). */
  imoveis: Array<Record<string, unknown>>;
  /** Locação: `imovel` (singular, objeto). `imoveis` fica vazio nessa esteira. */
  imovel?: Record<string, unknown>;
  garantia?: { tipo?: string; fiador?: Record<string, unknown> };
}

export function proposalPartiesSnapshot(dataJson: unknown): ProposalPartiesSnapshot {
  const d = (dataJson && typeof dataJson === "object" ? dataJson : {}) as Record<string, unknown>;
  const list = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
  const g = d.garantia && typeof d.garantia === "object" ? (d.garantia as Record<string, unknown>) : undefined;
  return {
    vendedores: list(d.vendedores),
    compradores: list(d.compradores),
    locadores: list(d.locadores),
    locatarios: list(d.locatarios),
    imoveis: list(d.imoveis),
    imovel: d.imovel && typeof d.imovel === "object" ? (d.imovel as Record<string, unknown>) : undefined,
    garantia: g
      ? {
          tipo: typeof g.tipo === "string" ? g.tipo : undefined,
          fiador: g.fiador && typeof g.fiador === "object" ? (g.fiador as Record<string, unknown>) : undefined,
        }
      : undefined,
  };
}
