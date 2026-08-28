// Plano de geração materializado (Workstream B — revisor pós-geração).
//
// A geração de contrato é 100% determinística: `pickTemplateByFacts` elege o
// template, `rankSlotCandidates` elege a cláusula do slot. Mas o que ela
// DECIDIA se perdia — `garantiaMatched`/`templateNotice` (D16) só existiam no
// corpo do 201, e o `resolved[]`/`failures[]` do resolveClauseSlots morria num
// console.error. Este módulo congela a decisão em `Contract.generationPlanJson`
// no momento do create: é o ground truth contra o qual a revisão pós-geração
// confere o documento final.
//
// Módulo PURO (sem prisma, sem rede) — testável sem banco, importável de
// qualquer lado. O único import de valor (`slotToken`) também é puro.
import type {
  ClauseSlotFailure,
  ResolvedClauseSlot,
} from "@/lib/templates/clause-slots";
import { slotToken } from "@/lib/templates/clause-slots";
import { normalizeGarantiaTipo } from "@/lib/contracts/template-category";

export const GENERATION_PLAN_VERSION = 1;

export type GenerationPlanFamily = "venda" | "locacao";

/**
 * Evidência de presença da cláusula eleita: os primeiros ~160 chars do
 * conteúdo que entrou no slot, normalizados (sem tags, whitespace colapsado,
 * minúsculas). O check da revisão normaliza o texto do documento do MESMO
 * jeito e afirma `includes(contentHead)` — sem guardar a cláusula inteira.
 */
export interface GenerationPlanSlotEvidence {
  slot: string;
  knowledgeItemId?: string;
  contentHead: string;
}

export interface GenerationPlan {
  version: number;
  family: GenerationPlanFamily;
  templateId: string;
  templateName: string;
  /** "handlebars" | "google_docs" */
  engine: string;
  modalidade: string | null;
  selection: {
    /** true = operador escolheu o template na rota (o matcher nem rodou). */
    manual: boolean;
    /** Só na locação com matcher: a garantia do template = a do form? */
    garantiaMatched?: boolean;
    /** O aviso D16, antes volátil (só no 201/toast). */
    templateNotice?: string;
  };
  garantia?: { tipo: string | null; provider: string | null };
  slots?: {
    resolved: ResolvedClauseSlot[];
    failures: ClauseSlotFailure[];
  };
  slotEvidence?: GenerationPlanSlotEvidence[];
}

export const EVIDENCE_HEAD_CHARS = 160;

/**
 * Normalização usada nos DOIS lados da comparação de presença (contentHead na
 * gravação, texto do doc na leitura). Remove tags, decodifica as entidades
 * comuns do export do Drive, colapsa whitespace e baixa a caixa — o suficiente
 * para "o mesmo texto" sobreviver ao round-trip HTML → Doc → export.
 */
export function normalizeEvidenceText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface BuildGenerationPlanInput {
  family: GenerationPlanFamily;
  template: {
    id: string;
    name: string;
    engine: string;
    modalidade?: string | null;
  };
  /** true quando `opts.template` veio da rota (escolha manual do operador). */
  manualTemplate: boolean;
  garantiaMatched?: boolean;
  templateNotice?: string;
  /** dataJson do form — só para ler `garantia.tipo`/`garantia.provider`. */
  dataJson?: unknown;
  /** Resultado COMPLETO do resolveClauseSlots (locação). */
  slots?: {
    values: Record<string, string>;
    resolved: ResolvedClauseSlot[];
    failures: ClauseSlotFailure[];
  };
}

export function buildGenerationPlan(input: BuildGenerationPlanInput): GenerationPlan {
  const plan: GenerationPlan = {
    version: GENERATION_PLAN_VERSION,
    family: input.family,
    templateId: input.template.id,
    templateName: input.template.name,
    engine: input.template.engine,
    modalidade: input.template.modalidade ?? null,
    selection: { manual: input.manualTemplate },
  };
  if (input.garantiaMatched !== undefined) {
    plan.selection.garantiaMatched = input.garantiaMatched;
  }
  if (input.templateNotice) {
    plan.selection.templateNotice = input.templateNotice;
  }

  const garantiaRaw = (input.dataJson as { garantia?: { tipo?: unknown; provider?: unknown } } | null | undefined)
    ?.garantia;
  if (garantiaRaw && typeof garantiaRaw === "object") {
    const provider = garantiaRaw.provider;
    plan.garantia = {
      tipo: normalizeGarantiaTipo(garantiaRaw.tipo),
      provider: typeof provider === "string" && provider.trim() ? provider.trim() : null,
    };
  }

  if (input.slots) {
    plan.slots = {
      resolved: input.slots.resolved,
      failures: input.slots.failures,
    };
    const evidence: GenerationPlanSlotEvidence[] = [];
    for (const entry of input.slots.resolved) {
      const content = input.slots.values[slotToken(entry.slot)];
      if (!content) continue;
      const head = normalizeEvidenceText(content).slice(0, EVIDENCE_HEAD_CHARS);
      if (!head) continue;
      evidence.push({
        slot: entry.slot,
        ...(entry.knowledgeItemId ? { knowledgeItemId: entry.knowledgeItemId } : {}),
        contentHead: head,
      });
    }
    if (evidence.length > 0) plan.slotEvidence = evidence;
  }

  return plan;
}

/**
 * Leitura defensiva do Json cru do banco. Malformado/versão desconhecida →
 * null (o revisor pula as checagens que dependem do plano, nunca lança).
 */
export function parseGenerationPlan(json: unknown): GenerationPlan | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = json as Record<string, unknown>;
  if (raw.version !== GENERATION_PLAN_VERSION) return null;
  if (raw.family !== "venda" && raw.family !== "locacao") return null;
  if (typeof raw.templateId !== "string" || !raw.templateId) return null;
  if (typeof raw.templateName !== "string") return null;
  if (typeof raw.engine !== "string") return null;
  const selection = raw.selection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return null;
  if (typeof (selection as Record<string, unknown>).manual !== "boolean") return null;
  return json as GenerationPlan;
}
