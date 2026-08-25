/**
 * Classificação de um item do lote — a costura entre o determinístico (Fase A1)
 * e o julgamento por LLM (Fase A2).
 *
 * ## Por que uma interface, e não uma função
 *
 * A Fase A1 entrega o esqueleto inteiro do pipeline com os DOIS pontos de
 * julgamento ainda ausentes. Este é o primeiro deles: "que documento é este?".
 * O palpite determinístico já existe e é bom (`suggestDocType` lê o TÍTULO do
 * instrumento, `suggestGarantiaTipo` casa palavra-chave de modalidade), e é ele
 * que roda hoje. Quando a chamada ao Haiku entrar, ela implementa
 * {@link ItemClassifier} e o executor não muda uma linha — o que troca é qual
 * implementação o run recebe.
 *
 * O campo `via` da classificação persistida diz QUEM decidiu. Sem ele, um run
 * antigo e um run novo ficariam indistinguíveis no banco depois da A2.
 *
 * ## O pré-cômputo determinístico é insumo, não rascunho
 *
 * Mesmo depois da A2, o classificador LLM deve receber o palpite determinístico
 * pronto: ele é barato, é auditável e ancora o modelo em vez de deixá-lo
 * inventar uma taxonomia. É por isso que {@link precomputeItemSignals} é
 * exportado separado — a implementação LLM chama exatamente o mesmo pré-cômputo.
 *
 * Módulo sem prisma e sem rede: o I/O (OCR, LLM) fica no executor.
 */

import type { GarantiaTipo } from "@/lib/contracts/template-category";
import {
  guessDocumentGarantia,
  ingestionFamilyKey,
} from "@/lib/templates/ingestion-triage";
import {
  ingestDocTypeDef,
  modalidadeForIngest,
  suggestDocType,
  type IngestDocType,
} from "@/lib/templates/ingestion-types";
import type { UploadClassification, UploadKind } from "@/lib/knowledge/upload-classifier";
import { detectPii, type PiiFinding, type PiiKind } from "@/lib/ingestion/pii";

/** Quem decidiu a classificação deste item. */
export type ClassifiedVia = "intake" | "deterministic" | "llm";

/**
 * Duplicata detectada no intake: o arquivo já virou template nesta org. Vira
 * DESCARTE SUGERIDO, não erro — o operador pode querer reingerir (um modelo
 * revisado com o mesmo corpo, um template arquivado por engano).
 */
export interface DuplicateSuggestion {
  reason: "duplicate_source_hash";
  templateId: string;
  templateName: string;
}

/** O que fica em `IngestionItem.classification`. */
export interface ItemClassification {
  via: ClassifiedVia;
  /** Tipo na linguagem do usuário (`contrato_locacao`…), ou null. */
  docType: IngestDocType | null;
  /** Sub-opção do tipo (`residencial`, `financiamento`…). */
  subOption: string | null;
  /** Modalidade de `ContractTemplate` resolvida a partir de tipo + sub-opção. */
  modalidade: string | null;
  /** Garantia identificada no texto — entra na chave de família FINA. */
  garantiaTipo: GarantiaTipo | null;
  /** `{docType}:{modalidade}:{garantiaTipo}` — ver {@link familyKey}. */
  familyKey: string;
  /** Estrutura do upload (`template` | `clauses` | `knowledge`). */
  uploadKind: UploadKind;
  confidence: number;
  /** Frase curta em PT-BR — o "porquê" mostrado no card. */
  reason: string;
  /** Presente só quando o item nasceu como descarte sugerido. */
  duplicate?: DuplicateSuggestion;
  /**
   * Rótulo HUMANO do fornecedor da garantia ("Porto Seguro", "Tokio Marine"),
   * ou null. Rótulo e não slug de propósito: quem slugifica é o executor, com
   * `slugifyProviderTag` — duas slugificações do mesmo nome divergiriam no
   * primeiro acento e a cláusula ficaria inalcançável.
   *
   * Só o classificador LLM preenche: o determinístico não distingue "o
   * documento é da Porto Seguro" de "o documento cita a Porto Seguro".
   */
  provider?: string | null;
  /**
   * O documento é uma INSTÂNCIA preenchida (dados reais de um cliente), não uma
   * minuta em branco. Não é motivo de erro — é o insumo do descarte sugerido
   * `filled_instance` e do gate de PII da cláusula.
   */
  isFilledInstance?: boolean;
  /**
   * Onde o LLM discordou do palpite determinístico. O LLM PREVALECE (é ele que
   * está nos campos acima), mas a divergência não pode sumir: ela vira issue
   * `classification_conflict` no plano, para a revisão humana ver que houve
   * uma decisão a tomar e qual foi.
   */
  conflicts?: ItemClassificationConflict[];
}

/** Um campo em que heurística e LLM discordaram. */
export interface ItemClassificationConflict {
  field: "docType" | "subOption" | "modalidade" | "garantiaTipo";
  /** Valor do palpite determinístico (o que `precomputeItemSignals` disse). */
  heuristic: string | null;
  /** Valor que o LLM devolveu — o que ficou gravado. */
  llm: string | null;
}

/** Resumo de PII gravado em `IngestionItem.piiReport`. */
export interface ItemPiiReport {
  /** Total de ocorrências detectadas (inclui as de baixa confiança). */
  total: number;
  /** Contagem por categoria — nunca o valor em si. */
  byKind: Partial<Record<PiiKind, number>>;
  /** Maior confiança observada; 0 quando nada foi detectado. */
  maxConfidence: number;
}

export interface ClassifyItemInput {
  filename: string;
  text: string;
  /** Classificação estrutural já calculada pelo executor (`upload-classifier`). */
  upload: UploadClassification;
}

export interface ClassifiedItem {
  classification: ItemClassification;
  piiReport: ItemPiiReport;
}

/**
 * O contrato que a Fase A2 implementa com o Haiku. A implementação atual é
 * `deterministicItemClassifier`; a próxima recebe os mesmos insumos e devolve o
 * mesmo shape, com `via: "llm"`.
 */
export interface ItemClassifier {
  /** Identifica a implementação nos logs e no relatório do run. */
  readonly name: string;
  classify(input: ClassifyItemInput): Promise<ClassifiedItem>;
}

// ────────────────────────────────────────────────────────────────────────────
// Chave de família FINA
// ────────────────────────────────────────────────────────────────────────────

/** Componente ausente na chave — literal, para a chave nunca ter buraco vazio. */
const NONE = "-";

/**
 * `{docType}:{modalidade}:{garantia}` — a chave que decide o que pode agrupar
 * com o quê.
 *
 * O par `{modalidade}:{garantia}` é o mesmo `ingestionFamilyKey` da triagem
 * client-side, reusado de propósito: a regra de produto ("um modelo físico por
 * modalidade DE GARANTIA") tem de valer igual nos dois caminhos, e duas
 * implementações da mesma regra divergem no primeiro ajuste. O `docType` vem na
 * frente porque o pipeline server-side recebe o acervo INTEIRO, onde documentos
 * de naturezas diferentes podem cair na mesma modalidade.
 *
 * Duas consequências, ambas deliberadas:
 *
 * 1. **A garantia entra na chave.** Modelos com garantias DIFERENTES nunca
 *    agrupam. Consolidar um contrato com fiador e um com caução produziria uma
 *    "base comum" cuja maior divergência é a cláusula de garantia — e é
 *    exatamente essa cláusula que o operador precisa ver inteira, por modelo,
 *    antes de decidir.
 *
 * 2. **O garantidor NÃO entra.** As quatro minutas de seguro-fiança de uma
 *    imobiliária (Porto Seguro, Tokio Marine, Pottencial, TOO) são o MESMO
 *    modelo variando o parceiro: têm de agrupar, e a diferença vira uma cláusula
 *    por garantidor, com a tag `provider:` que `ingestSlotClauses` já grava.
 */
export function familyKey(parts: {
  docType: IngestDocType | null;
  modalidade: string | null;
  garantiaTipo: GarantiaTipo | null;
}): string {
  const fine = ingestionFamilyKey({
    modalidade: parts.modalidade,
    garantia: parts.garantiaTipo,
  });
  return `${parts.docType ?? NONE}:${fine ?? `${NONE}:${NONE}`}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Pré-cômputo determinístico
// ────────────────────────────────────────────────────────────────────────────

export interface ItemSignals {
  docType: IngestDocType | null;
  subOption: string | null;
  modalidade: string | null;
  garantiaTipo: GarantiaTipo | null;
  reason: string;
}

/**
 * Palpite determinístico completo de um item: tipo, sub-opção, modalidade e
 * garantia. É o insumo tanto da implementação atual quanto da chamada LLM.
 *
 * Documento que não é contrato inteiro (`clauses`/`knowledge`) sai com
 * `docType: "clausulas"` e sem modalidade — não há modelo a consolidar ali.
 */
export function precomputeItemSignals(input: ClassifyItemInput): ItemSignals {
  const suggestion = suggestDocType({
    classificationKind: input.upload.kind,
    classificationReason: input.upload.reason,
    filename: input.filename,
    text: input.text,
  });

  const subOption = suggestion.subOption ?? null;
  const modalidade = modalidadeForIngest(suggestion.type, subOption);

  // A garantia só é um EIXO onde o tipo de documento admite o slot. Num
  // contrato de compra e venda, "fiador" no texto é ruído.
  //
  // `guessDocumentGarantia` (e não `suggestGarantiaTipo` sobre o texto cru):
  // ele recorta antes os parágrafos que de fato falam de garantia. Sobre o
  // documento inteiro, a cláusula do seguro contra INCÊNDIO — que cita
  // "apólice" e existe em todo contrato de locação — responderia
  // `seguro_fianca` até no modelo de fiador.
  const admitsGarantia = ingestDocTypeDef(suggestion.type).slots.includes("garantia");
  const garantiaTipo = admitsGarantia ? guessDocumentGarantia(input.text) : null;

  return {
    docType: suggestion.type,
    subOption,
    modalidade,
    garantiaTipo,
    reason: suggestion.reason,
  };
}

/** Contagem de PII por categoria — o relatório nunca guarda o valor detectado. */
export function summarizePii(findings: readonly PiiFinding[]): ItemPiiReport {
  const byKind: Partial<Record<PiiKind, number>> = {};
  let maxConfidence = 0;
  for (const f of findings) {
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    if (f.confidence > maxConfidence) maxConfidence = f.confidence;
  }
  return { total: findings.length, byKind, maxConfidence };
}

/**
 * A implementação da Fase A1: zero IA, zero custo, resultado estável entre runs.
 *
 * A confiança devolvida é a do `upload-classifier` — é a única que temos medida.
 * Quando o LLM entrar, ele substitui esta implementação inteira.
 */
export const deterministicItemClassifier: ItemClassifier = {
  name: "deterministic",
  async classify(input: ClassifyItemInput): Promise<ClassifiedItem> {
    const signals = precomputeItemSignals(input);
    return {
      classification: {
        via: "deterministic",
        docType: signals.docType,
        subOption: signals.subOption,
        modalidade: signals.modalidade,
        garantiaTipo: signals.garantiaTipo,
        familyKey: familyKey(signals),
        uploadKind: input.upload.kind,
        confidence: input.upload.confidence,
        reason: signals.reason,
      },
      piiReport: summarizePii(detectPii(input.text)),
    };
  },
};

/** Classificação de um item que nasceu como descarte sugerido (dedup no intake). */
export function duplicateClassification(
  duplicate: DuplicateSuggestion
): ItemClassification {
  return {
    via: "intake",
    docType: null,
    subOption: null,
    modalidade: null,
    garantiaTipo: null,
    familyKey: familyKey({ docType: null, modalidade: null, garantiaTipo: null }),
    uploadKind: "template",
    confidence: 1,
    reason: `Este arquivo já foi importado como o modelo "${duplicate.templateName}".`,
    duplicate,
  };
}
