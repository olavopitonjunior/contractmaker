/**
 * Decisões PURAS da triagem da central de ingestão.
 *
 * O diálogo (`components/templates/DocumentIngestionDialog.tsx`) é client-side
 * pesado — fila de upload, estado por arquivo, N selects. O que ele DECIDE, no
 * entanto, é determinístico e cabe aqui: qual família cada arquivo pertence,
 * qual `matchCriteria` o modelo consolidado recebe e qual trecho vira slot de
 * cláusula num arquivo avulso. Separado pra poder ser testado sem montar a tela.
 *
 * REGRA DE PRODUTO que orienta este módulo: **um modelo físico por modalidade
 * DE GARANTIA**. Fiador, caução, seguro-fiança e título são contratos
 * diferentes e nunca podem virar uma base só. Quando o que muda é apenas o
 * FORNECEDOR (Porto Seguro × Tokio × Pottencial), aí sim é o mesmo modelo — a
 * diferença vira cláusula do acervo com tag `provider:<slug>`.
 *
 * Client-safe: sem prisma, sem fs, sem rede.
 */

import {
  normalizeGarantiaTipo,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";
import { DEFAULT_GARANTIA_OPTIONS } from "@/lib/forms/garantia-catalog";
import { paragraphKey, suggestGarantiaTipo, toParagraphs } from "./consolidation";
import type { CriteriaField } from "./ingestion-types";
import type { SlotBlockIssueReason } from "./apply-clause-slot";

// ────────────────────────────────────────────────────────────────────────────
// Família fina (modalidade + garantia)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sufixo da chave quando a garantia do arquivo é desconhecida. NÃO colide com
 * `sem_garantia` (que é uma garantia declarada, "a locação não tem garantia"):
 * "não sei qual é" e "não tem" são famílias distintas de propósito — juntá-las
 * consolidaria um contrato sem cláusula de garantia com outro cuja cláusula
 * simplesmente não foi reconhecida.
 */
export const UNKNOWN_GARANTIA_KEY = "sem";

/**
 * Chave de família do agrupamento: `{modalidade}:{garantia}`.
 *
 * A modalidade sozinha NÃO serve. Dois contratos de locação residencial que só
 * diferem na garantia passam folgado nos limiares de Dice/contenção — o texto é
 * o mesmo menos uma cláusula — e virariam UMA base com slot, exatamente o
 * oposto da regra de produto. Com a garantia na chave, `groupSimilarDocs` (que
 * já recusa famílias diferentes) só junta o que de fato é o mesmo contrato.
 */
export function ingestionFamilyKey(input: {
  modalidade: string | null;
  garantia?: string | null;
}): string | null {
  if (!input.modalidade) return null;
  const garantia = normalizeGarantiaTipo(input.garantia) ?? UNKNOWN_GARANTIA_KEY;
  return `${input.modalidade}:${garantia}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Onde o documento fala de garantia
// ────────────────────────────────────────────────────────────────────────────

/**
 * Marca de "este parágrafo trata da garantia da locação", sobre a chave
 * normalizada (minúsculas, sem acento).
 *
 * O recorte é o que torna o palpite confiável: `suggestGarantiaTipo` aplicado ao
 * documento INTEIRO responde `seguro_fianca` para qualquer contrato de locação,
 * porque a cláusula do seguro contra incêndio — presente nos quatro arquivos do
 * corpus real, inclusive no de fiador — cita "apólice". Essa cláusula não fala
 * de garantia locatícia e cai fora daqui.
 */
const GARANTIA_CONTEXT = /garantia|fiador|fianca|caucao|capitalizacao/;

/** Trecho contíguo de parágrafos que fala de garantia. */
export interface GarantiaExcerpt {
  /** Índice do 1º parágrafo dentro de `toParagraphs(text)`. */
  index: number;
  paragraphs: string[];
}

/** Todos os trechos contíguos do documento que falam de garantia, na ordem. */
export function garantiaExcerpts(text: string): GarantiaExcerpt[] {
  const paragraphs = toParagraphs(text);
  const out: GarantiaExcerpt[] = [];
  let current: GarantiaExcerpt | null = null;

  for (let i = 0; i < paragraphs.length; i++) {
    if (GARANTIA_CONTEXT.test(paragraphKey(paragraphs[i]))) {
      if (current) current.paragraphs.push(paragraphs[i]);
      else current = { index: i, paragraphs: [paragraphs[i]] };
    } else if (current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

function excerptSize(excerpt: GarantiaExcerpt): number {
  return excerpt.paragraphs.reduce((n, p) => n + p.length, 0);
}

/**
 * Palpite determinístico da garantia do DOCUMENTO, para o caso em que o
 * operador ainda não escolheu a variante no formulário da triagem. Junta todos
 * os trechos de garantia e delega a `suggestGarantiaTipo` (a mesma ordem de
 * precedência do resto da ingestão). Sem trecho de garantia → `null`.
 */
export function guessDocumentGarantia(text: string): GarantiaTipo | null {
  const excerpts = garantiaExcerpts(text);
  if (excerpts.length === 0) return null;
  return suggestGarantiaTipo(excerpts.flatMap((e) => e.paragraphs).join("\n"));
}

// ────────────────────────────────────────────────────────────────────────────
// Bloco candidato a slot (arquivo avulso)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Espelha `MIN_SLOT_BLOCK_CHARS` de `apply-clause-slot.ts`, que é módulo de
 * SERVIDOR (importa o cliente do Google Docs) e não pode ser puxado pra dentro
 * do diálogo. Oferecer aqui um parágrafo que o servidor recusaria por
 * `too-short` só produziria uma falha anunciada. O teste trava os dois valores.
 */
export const MIN_SLOT_PARAGRAPH_CHARS = 40;

export interface SlotBlockCandidate {
  /** Parágrafos que viram o slot — na ordem, o 1º recebe o token. */
  paragraphs: string[];
  /**
   * Parágrafos do trecho que ficam no modelo: curtos demais pra guarda do
   * servidor, ou repetidos no documento (o `replaceAllText` é global). Não é
   * erro — é o que a UI precisa dizer ao operador antes de ele confirmar.
   */
  skipped: string[];
}

/**
 * O bloco que um arquivo AVULSO ofereceria como slot de garantia.
 *
 * Escolhe o MAIOR trecho de garantia (mesmo critério de `primaryDifferenceRow`:
 * a cláusula de verdade é a maior; menções de passagem em outras cláusulas são
 * curtas) e descarta o que a trava tudo-ou-nada do servidor rejeitaria.
 * Devolve `null` quando não sobra parágrafo utilizável.
 */
export function garantiaSlotCandidate(text: string): SlotBlockCandidate | null {
  const excerpts = garantiaExcerpts(text);
  if (excerpts.length === 0) return null;
  const primary = excerpts.reduce((best, e) =>
    excerptSize(e) > excerptSize(best) ? e : best
  );

  // Repetição medida entre os PARÁGRAFOS normalizados, não por `indexOf` no
  // texto cru: é a mesma unidade que o servidor compara contra o Doc.
  const all = toParagraphs(text);
  const paragraphs: string[] = [];
  const skipped: string[] = [];
  for (const p of primary.paragraphs) {
    const unique = all.filter((q) => q === p).length === 1;
    if (unique && p.length >= MIN_SLOT_PARAGRAPH_CHARS) paragraphs.push(p);
    else skipped.push(p);
  }
  return paragraphs.length > 0 ? { paragraphs, skipped } : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Fornecedor da variante
// ────────────────────────────────────────────────────────────────────────────

/**
 * Espelho local de `slugifyProviderTag` (clause-slots), que não pode ser
 * importado aqui: aquele módulo puxa o pipeline de render. Serve só pra decidir
 * se duas variantes do MESMO tipo de garantia apontam pro mesmo garantidor — a
 * tag de verdade é gerada no servidor. O teste trava a equivalência.
 */
export function normalizeProviderKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Palpite do garantidor a partir do texto da variante — só para os garantidores
 * do catálogo PADRÃO (as seguradoras que toda imobiliária de locação usa). É um
 * default de campo de texto: o catálogo real da org vive no banco e quem tem a
 * última palavra é o operador.
 */
export function suggestProviderName(text: string): string | null {
  const key = paragraphKey(text);
  for (const option of DEFAULT_GARANTIA_OPTIONS) {
    if (key.includes(paragraphKey(option.provider))) return option.provider;
  }
  return null;
}

/**
 * Variantes que o servidor recusaria (422): mesmo tipo de garantia e mesmo
 * garantidor — inclusive "nenhum garantidor" — são a MESMA cláusula do acervo.
 * Devolve os tipos em conflito, pra tela avisar antes de o operador confirmar.
 *
 * É o caso que a família fina tornou comum: um grupo de 4 minutas de
 * seguro-fiança tem uma garantia só, e o que as separa no acervo é o
 * `provider:<slug>`.
 */
export function collidingVariantValues(
  variants: ReadonlyArray<{ value?: string | null; provider?: string | null }>
): string[] {
  const seen = new Set<string>();
  const collided = new Set<string>();
  for (const v of variants) {
    if (!v.value) continue;
    const key = `${v.value}\u0000${normalizeProviderKey(v.provider)}`;
    if (seen.has(key)) collided.add(v.value);
    seen.add(key);
  }
  return Array.from(collided).sort();
}

// ────────────────────────────────────────────────────────────────────────────
// matchCriteria do modelo consolidado
// ────────────────────────────────────────────────────────────────────────────

export type TriageCriteria = Partial<Record<CriteriaField, string>>;

/** Eixos que valem por UNANIMIDADE dos membros (a garantia tem regra própria). */
const SHARED_CRITERIA_FIELDS: CriteriaField[] = [
  "fiadorPessoa",
  "pessoa",
  "admImobiliaria",
];

function distinct(values: ReadonlyArray<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

/**
 * `matchCriteria` do modelo que sai de um grupo consolidado.
 *
 * Com a família fina (`ingestionFamilyKey`) todo grupo tem UMA garantia, então
 * amarrar o modelo a ela é o que o torna alcançável: sem nenhum eixo gravado o
 * template pontua 0 no `scoreTemplateAgainstFacts` e nunca é escolhido por um
 * fato do formulário — empata com o genérico e depende do `isDefault`.
 *
 * A única exceção é o operador ter rotulado as variantes com garantias
 * DIFERENTES dentro do mesmo grupo (ele pode: o <select> do card é livre). Aí a
 * garantia é omitida — marcar uma delas desclassificaria o modelo em todo
 * formulário que escolhesse a outra.
 *
 * Os demais eixos entram só quando TODOS os membros declaram o mesmo valor: um
 * membro em "Qualquer" significa que o modelo serve àquele caso também, e
 * gravar o eixo o desclassificaria.
 */
export function consolidatedMatchCriteria(input: {
  /** Garantia da família (escolha do operador na triagem ou palpite). */
  familyGarantia?: string | null;
  /** Opção do formulário escolhida para cada variante do grupo. */
  variantValues: ReadonlyArray<string | null | undefined>;
  /** `criteria` de cada membro do grupo. */
  memberCriteria: ReadonlyArray<TriageCriteria>;
}): TriageCriteria {
  const out: TriageCriteria = {};

  const chosen = distinct(
    input.variantValues.map((v) => normalizeGarantiaTipo(v) ?? undefined)
  );
  if (chosen.length === 1) {
    out.garantia = chosen[0];
  } else if (chosen.length === 0) {
    const family = normalizeGarantiaTipo(input.familyGarantia);
    if (family) out.garantia = family;
  }

  for (const field of SHARED_CRITERIA_FIELDS) {
    if (input.memberCriteria.length === 0) break;
    const values = input.memberCriteria.map((c) => c[field]);
    if (values.some((v) => !v)) continue;
    const unique = distinct(values);
    if (unique.length === 1) out[field] = unique[0];
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Falha ao abrir o slot — motivo em PT-BR
// ────────────────────────────────────────────────────────────────────────────

/**
 * Motivos de `apply-clause-slot` na língua do operador. Ele não precisa saber o
 * que é `replaceAllText`; precisa saber que o modelo ficou com a cláusula fixa e
 * o que olhar no arquivo.
 */
export const SLOT_ISSUE_MESSAGES: Record<SlotBlockIssueReason, string> = {
  "too-short": "o trecho é curto demais para ser localizado com segurança",
  "not-found": "não encontramos o trecho no documento enviado",
  ambiguous: "o trecho aparece mais de uma vez no documento",
  "doc-unreadable": "não conseguimos abrir o documento no Google Docs",
  "batch-failed": "o Google Docs recusou a edição",
  "replace-noop":
    "o trecho está quebrado em pedaços de formatação e nada foi substituído",
  "over-matched": "o trecho também aparece no cabeçalho ou rodapé do documento",
  "verify-failed": "a conferência depois da edição não confirmou o espaço",
  "verify-unavailable": "não deu para conferir o documento depois da edição",
  "token-missing": "o espaço não está mais no documento",
};

/** Recorte de `ApplyClauseSlotReport` que o diálogo consome da resposta. */
export interface SlotReportLite {
  slot: string;
  applied: boolean;
  reasons: SlotBlockIssueReason[];
}

function isIssueReason(v: unknown): v is SlotBlockIssueReason {
  return typeof v === "string" && v in SLOT_ISSUE_MESSAGES;
}

/** Normaliza o `slots` da resposta de `from-docx` (JSON não tipado). */
export function parseSlotReports(raw: unknown): SlotReportLite[] {
  if (!Array.isArray(raw)) return [];
  const out: SlotReportLite[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { slot?: unknown; applied?: unknown; issues?: unknown };
    if (typeof r.slot !== "string") continue;
    const issues = Array.isArray(r.issues) ? r.issues : [];
    out.push({
      slot: r.slot,
      applied: r.applied === true,
      reasons: Array.from(
        new Set(
          issues
            .map((i) => (i && typeof i === "object" ? (i as { reason?: unknown }).reason : null))
            .filter(isIssueReason)
        )
      ),
    });
  }
  return out;
}

/**
 * Frase para o card quando um slot PEDIDO não foi aberto. `null` quando tudo
 * correu bem — a criação do modelo nunca é bloqueada por isto.
 */
export function slotFailureMessage(reports: readonly SlotReportLite[]): string | null {
  const failed = reports.filter((r) => !r.applied);
  if (failed.length === 0) return null;
  const motivos = distinct(failed.flatMap((r) => r.reasons)).map(
    (reason) => SLOT_ISSUE_MESSAGES[reason as SlotBlockIssueReason]
  );
  return (
    "O espaço de garantia não foi aberto" +
    (motivos.length ? `: ${motivos.join("; ")}` : "") +
    ". O modelo ficou com a cláusula fixa — revise antes de ativar."
  );
}
