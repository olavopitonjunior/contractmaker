/**
 * Reaplica os slots de cláusula de um modelo a partir do PLANO do lote que o
 * criou — sem reingestão, sem edição manual no Doc.
 *
 * Por que existe: `applyClauseSlotToDoc` só rodava na ingestão, e a única
 * saída para um slot que não abriu era o aviso na tela mandando o operador
 * apagar a cláusula no Google Docs e escrever `{{slot_garantia}}` à mão. Em
 * produção (04/09/2026) três modelos de caução da RE/MAX Trio ficaram assim —
 * por um espaço não-quebrável que o export normaliza e a API não (a mesma
 * causa do #581). O conserto do mecanismo não alcançava os modelos já
 * ingeridos: este módulo é o que alcança.
 *
 * Os parágrafos do bloco vêm do `PlannedTemplate.slotBlocks` do run que criou
 * o modelo, encontrado pela linha `execution.templates[].templateId` do
 * relatório de execução — o mesmo dado que a ingestão usou, sem pedir nada ao
 * operador. Quem aplica é o mesmo `applyClauseSlotToDoc`, com as mesmas
 * travas (tudo-ou-nada, ocorrência única, releitura decide).
 */
import { prisma } from "@/lib/db/prisma";
import { readExecutionReport } from "@/lib/ingestion/execution-report";
import { parseLibraryPlan } from "@/lib/ingestion/plan-review";
import { applyClauseSlotToDoc, type ApplyClauseSlotReport } from "./apply-clause-slot";
import {
  CLAUSE_SLOT_KEYS,
  detectClauseSlots,
  slotDeclarationComment,
  type ClauseSlotKey,
} from "./clause-slots";
import { readDraftReport } from "./pii-gate";
import { GOOGLE_DOCS_SOURCE_HEADER } from "./validate-gdoc";

export type SlotBlocks = Partial<Record<ClauseSlotKey, string[]>>;

interface RunLike {
  libraryPlan: unknown;
  planReviewed: unknown;
  report: unknown;
}

/**
 * Os `slotBlocks` planejados para o modelo, ou `null` quando nenhum run da org
 * o criou (envio avulso, run apagado, plano em formato antigo). PURA.
 *
 * O plano que vale é o REVISADO (`planReviewed`) — é o que o executor aplicou;
 * o `libraryPlan` é o rascunho do planner e só serve de fallback quando a
 * revisão não existiu.
 */
export function plannedSlotBlocksFor(runs: readonly RunLike[], templateId: string): SlotBlocks | null {
  // A linha de execução NÃO é filtrada por `status`, de propósito: uma linha
  // `duplicate` aponta para um modelo cujo DOCX é byte a byte o mesmo (a
  // deduplicação é por sha256 do arquivo), então os `slotBlocks` do plano
  // daquele run descrevem o mesmo documento. E `templateId` é cuid novo por
  // modelo — não há como outro run "recriar" o mesmo id.
  for (const run of runs) {
    const execution = readExecutionReport(run.report);
    const line = execution?.templates.find((t) => t.templateId === templateId);
    if (!line) continue;
    const plan = parseLibraryPlan(run.planReviewed ?? run.libraryPlan);
    const planned = plan?.templates.find((t) => t.sourceItemId === line.sourceItemId);
    if (!planned) continue;
    return planned.slotBlocks ?? {};
  }
  return null;
}

/** Slots com bloco não vazio no plano, na ordem canônica. */
export function requestedSlotsOf(slotBlocks: SlotBlocks): ClauseSlotKey[] {
  return CLAUSE_SLOT_KEYS.filter((s) => (slotBlocks[s] ?? []).length > 0);
}

export class SlotReapplyError extends Error {
  constructor(
    public readonly code: "TEMPLATE_NOT_FOUND" | "NOT_GOOGLE_DOCS" | "TEMPLATE_ACTIVE" | "PLAN_MISSING" | "NO_SLOTS",
    message: string
  ) {
    super(message);
    this.name = "SlotReapplyError";
  }
}

/**
 * Fonte do modelo com os slots declarados: cabeçalho, declaração, e depois
 * tudo que já estava lá e não era nem cabeçalho nem declaração. PURA.
 */
export function declareSlots(source: string | null | undefined, declared: ClauseSlotKey[]): string {
  const header = GOOGLE_DOCS_SOURCE_HEADER.trim();
  const outras = (source ?? "")
    .split("\n")
    .filter((linha) => {
      const t = linha.trim();
      if (!t || t === header) return false;
      return detectClauseSlots(t).length === 0;
    });
  return [GOOGLE_DOCS_SOURCE_HEADER, slotDeclarationComment(declared), ...outras]
    .filter((l) => l.length > 0)
    .join("\n");
}

export interface ReapplySlotsResult {
  reports: ApplyClauseSlotReport[];
  /** Slots declarados no template depois desta rodada. */
  declared: ClauseSlotKey[];
}

export async function reapplySlotsForTemplate(input: {
  templateId: string;
  orgId: string;
}): Promise<ReapplySlotsResult> {
  const template = await prisma.contractTemplate.findFirst({
    where: { id: input.templateId, orgId: input.orgId },
    select: {
      id: true,
      engine: true,
      status: true,
      googleTemplateDocId: true,
      draftReport: true,
      handlebarsSource: true,
    },
  });
  if (!template) throw new SlotReapplyError("TEMPLATE_NOT_FOUND", "Template não encontrado.");
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    throw new SlotReapplyError("NOT_GOOGLE_DOCS", "Modelo não é Google Docs.");
  }
  if (template.status === "active") {
    throw new SlotReapplyError(
      "TEMPLATE_ACTIVE",
      "Modelo ativo não pode ser editado. Volte-o para rascunho primeiro."
    );
  }

  const runs = await prisma.ingestionRun.findMany({
    where: { orgId: input.orgId },
    select: { libraryPlan: true, planReviewed: true, report: true },
    orderBy: { createdAt: "desc" },
    // Os planos são JSON grandes; o run que criou o modelo é recente por
    // construção (o modelo é rascunho). Teto contra org com centenas de lotes.
    take: 50,
  });
  const slotBlocks = plannedSlotBlocksFor(runs, template.id);
  if (!slotBlocks) {
    throw new SlotReapplyError(
      "PLAN_MISSING",
      "Não encontrei o lote que criou este modelo — os parágrafos da cláusula variável vêm do plano dele."
    );
  }
  const requested = requestedSlotsOf(slotBlocks);
  if (requested.length === 0) {
    throw new SlotReapplyError("NO_SLOTS", "O plano deste modelo não separou nenhuma cláusula variável.");
  }

  const reports: ApplyClauseSlotReport[] = [];
  for (const slot of requested) {
    reports.push(
      await applyClauseSlotToDoc({
        docId: template.googleTemplateDocId,
        slot,
        paragraphs: slotBlocks[slot] ?? [],
      })
    );
  }

  const applied = reports.filter((r) => r.applied).map((r) => r.slot);
  const declared = Array.from(
    new Set<ClauseSlotKey>([...detectClauseSlots(template.handlebarsSource), ...applied])
  );
  // A fonte de um modelo google_docs é cabeçalho + declaração de slots — mas
  // o PATCH aceita qualquer texto ali. O que não for nem um nem outro é
  // preservado: reaplicar um slot não pode apagar uma nota do operador.
  const handlebarsSource = declareSlots(template.handlebarsSource, declared);

  const draftReport = readDraftReport(template.draftReport);
  const previous = Array.isArray(draftReport.slots)
    ? (draftReport.slots as ApplyClauseSlotReport[])
    : [];
  const slots = [...previous.filter((s) => !requested.includes(s.slot)), ...reports];

  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: {
      draftReport: { ...draftReport, slots } as object,
      ...(applied.length > 0 ? { handlebarsSource } : {}),
    },
  });

  return { reports, declared };
}
