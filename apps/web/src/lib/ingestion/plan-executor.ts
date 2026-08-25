/**
 * Executor do plano aprovado — a única parte do pipeline que ESCREVE na
 * biblioteca da imobiliária.
 *
 * Entra o `ReviewedLibraryPlan` (o plano do planner depois da revisão humana),
 * saem templates `draft` no Drive, cláusulas no acervo e o relatório final do
 * run. Segue o mesmo padrão retomável de `run-executor.ts`: uma invocação = uma
 * fatia, claim atômico no `where`, `hasMore` para o caller re-encadear.
 *
 * ## A ordem é regra de produto, não preferência
 *
 * CLÁUSULAS PRIMEIRO, TEMPLATES DEPOIS. `applyClauseSlotToDoc` REMOVE do Doc o
 * trecho que virou slot: se a cláusula não estiver no acervo antes disso, a
 * redação da imobiliária deixa de existir nos dois lugares e a geração cai no
 * texto canônico da plataforma — em silêncio, com o contrato saindo com a
 * garantia errada. Foi essa a correção do commit a5e96583 na Central de
 * ingestão, e aqui vale igual.
 *
 * ## Uma invocação, UM template
 *
 * Cada template copia um Doc no Drive, abre os slots e roda o pass de IA de
 * placeholders. Dois deles não cabem com folga nos 120s de `maxDuration`, e uma
 * fatia interrompida pelo timeout deixaria o claim preso até a janela de stale.
 * As cláusulas, ao contrário, são transação de banco: vão todas na primeira
 * fatia.
 *
 * ## Idempotência
 *
 * O estado de execução vive no próprio `IngestionRun.report.execution`: cada
 * template/cláusula já aplicado tem uma linha lá, e reexecutar pula o que já
 * tem linha. A segunda rede é o dedup por `sourceHash` de
 * `ingestTemplateFromDocx`, que devolve `DUPLICATE_TEMPLATE` — tratado aqui
 * como "já feito", nunca como falha.
 *
 * ## O gate de PII
 *
 * Conteúdo de cláusula é o ÚNICO texto do plano que vira linha com embedding, e
 * embedding é irreversível. O plano promete conteúdo já sanitizado; este módulo
 * confere antes de gravar e recusa o que ainda tiver PII bloqueante. Recusar
 * uma cláusula custa uma cláusula; gravar CPF de cliente custa um vazamento.
 */

import { prisma } from "@/lib/db/prisma";
import { embedKnowledgeItem } from "@/lib/ai/knowledge";
import { detectPii, hasBlockingPii, type PiiFinding } from "@/lib/ingestion/pii";
import {
  parseLibraryPlan,
  parseReviewedPlan,
  selectApproved,
  clauseKey,
} from "@/lib/ingestion/plan-review";
import {
  runClaimWhere,
  type RunStatus,
} from "@/lib/ingestion/run-state";
import type {
  LibraryPlan,
  PlanDiscard,
  PlanIssue,
  PlannedClause,
  PlannedTemplate,
  ReviewedLibraryPlan,
} from "@/lib/ingestion/library-plan";
import {
  ingestSlotClauses,
  normalizeVariantProvider,
} from "@/lib/templates/ingest-clauses";
import {
  DuplicateTemplateError,
  ingestTemplateFromDocx,
} from "@/lib/templates/ingest-template-from-docx";
import { CLAUSE_SLOT_KEYS, type ClauseSlotKey } from "@/lib/templates/clause-slots";
import { parseMatchCriteria } from "@/lib/contracts/template-category";
import {
  computeGarantiaCoverage,
  type GarantiaCoverageReport,
} from "@/lib/templates/coverage";
import {
  EXECUTION_REPORT_VERSION,
  readExecutionReport,
  type ExecutedClause,
  type ExecutedTemplate,
  type ExecutionReport,
} from "@/lib/ingestion/execution-report";
import { MODULE_CATALOG, type ModuleKey } from "@/lib/modules/catalog";
import { getOrgModules } from "@/lib/modules/read";

/** Templates por invocação. Ver "Uma invocação, UM template" no cabeçalho. */
const TEMPLATES_PER_SLICE = 1;

/** Mesmo orçamento do `/advance`: para em 90s dos 120s de `maxDuration`. */
const SLICE_BUDGET_MS = Number(process.env.INGESTION_SLICE_BUDGET_MS ?? "90000");

/**
 * Operações de IA que o pipeline de ingestão pode gastar. A `AIUsage` não tem
 * coluna de run (não vamos mexer no schema por um relatório), então o custo é
 * atribuído por JANELA + operação: o que a org gastou NESTAS operações entre a
 * criação do run e o fim da execução. É uma aproximação por cima quando dois
 * runs correm juntos — e é honesta o suficiente para a pergunta que o operador
 * faz ("quanto custou subir meu acervo?").
 */
export const INGESTION_AI_OPERATIONS = [
  "ocr_tool",
  "ocr_form",
  "ocr_shadow",
  "knowledge_upload_classification",
  // Os dois pontos de julgamento por LLM da Fase A2 (classificação por
  // documento e decisão de conjunto). Strings soltas de propósito: uma operação
  // que ainda não existe no `AIOperation` simplesmente não casa nenhuma linha —
  // o relatório sai com custo a menos, nunca com erro.
  "ingest_classify",
  "ingest_plan",
  "template_placeholder_insertion",
  "embed_kb",
] as const;

export interface ExecutePlanResult {
  runId: string;
  /** false = outra invocação está com o run, ou ele não está em `executing`. */
  claimed: boolean;
  status: RunStatus | null;
  /** Escritas feitas NESTA invocação (cláusulas + templates). */
  processed: number;
  templatesCreated: number;
  clausesCreated: number;
  hasMore: boolean;
  report: ExecutionReport | null;
}

export interface ExecutePlanOptions {
  runId: string;
  /** Escopo do tenant; ausente na chamada interna (cron), que já listou o id. */
  orgId?: string;
  now?: Date;
  budgetMs?: number;
  /** Teto de templates desta invocação — os testes usam para observar a fatia. */
  maxTemplates?: number;
}

interface RunRow {
  id: string;
  orgId: string;
  createdBy: string | null;
  status: string;
  libraryPlan: unknown;
  planReviewed: unknown;
  report: unknown;
  createdAt: Date;
}

interface ItemRow {
  id: string;
  filename: string;
  fileKind: string;
  blobUrl: string;
  status: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Entrada
// ────────────────────────────────────────────────────────────────────────────

/**
 * Aplica uma fatia do plano aprovado.
 *
 * Nunca lança por falha de UM item: template que não sobe e cláusula que não
 * grava viram linha `failed` no relatório e o run segue. Só falha de RUN (plano
 * ilegível, banco fora) marca o run como `failed` — porque aí não há o que
 * aplicar.
 */
export async function executePlanSlice(
  options: ExecutePlanOptions
): Promise<ExecutePlanResult> {
  const now = options.now ?? new Date();
  const deadline = Date.now() + (options.budgetMs ?? SLICE_BUDGET_MS);

  const claim = await prisma.ingestionRun.updateMany({
    where: runClaimWhere({
      runId: options.runId,
      orgId: options.orgId,
      now,
      statuses: ["executing"],
    }),
    data: { startedAt: now },
  });
  if (claim.count === 0) {
    return idleResult(options.runId);
  }

  let report: ExecutionReport | null = null;
  try {
    const run = (await prisma.ingestionRun.findFirst({
      where: {
        id: options.runId,
        ...(options.orgId ? { orgId: options.orgId } : {}),
      },
      select: {
        id: true,
        orgId: true,
        createdBy: true,
        status: true,
        libraryPlan: true,
        planReviewed: true,
        report: true,
        createdAt: true,
      },
    })) as RunRow | null;
    if (!run) return idleResult(options.runId, true);

    const plan = parseLibraryPlan(run.libraryPlan);
    const reviewed = parseReviewedPlan(run.planReviewed);
    if (!plan || !reviewed) {
      await failRun(
        run.id,
        plan
          ? "Plano revisado ausente ou ilegível — a execução não foi iniciada."
          : "Plano da biblioteca ausente ou de versão desconhecida."
      );
      return { ...idleResult(run.id, true), status: "failed" };
    }

    const selection = selectApproved(plan, reviewed);
    const items = (await prisma.ingestionItem.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        filename: true,
        fileKind: true,
        blobUrl: true,
        status: true,
      },
    })) as ItemRow[];
    const itemById = new Map(items.map((i) => [i.id, i]));

    report = readExecutionReport(run.report) ?? initialReport(plan, reviewed, selection, now);

    let clausesCreated = 0;
    let templatesCreated = 0;

    // ─── FASE 1: cláusulas ────────────────────────────────────────────────
    // Toda a fase numa fatia só (é banco, não Drive) e SEMPRE antes dos
    // templates — ver o cabeçalho do módulo.
    let ranClauses = false;
    if (!report.clausesDone) {
      ranClauses = true;
      for (const clause of selection.clauses) {
        const line = await applyClause({
          orgId: run.orgId,
          createdBy: run.createdBy,
          clause,
          item: itemById.get(clause.sourceItemId) ?? null,
          applied: report.clauses,
        });
        report.clauses.push(line);
        if (line.status === "created") clausesCreated += 1;
        if (line.status === "pii_blocked") {
          report.discards.push({
            itemId: clause.sourceItemId,
            reason: "pii_unrecoverable",
            detail: `A cláusula "${clause.title}" não foi gravada: o texto ainda tem dados pessoais (${(line.piiKinds ?? []).join(", ")}).`,
          });
          report.issues.push({
            itemId: clause.sourceItemId,
            kind: "pii_leftover",
            detail: `Cláusula recusada pelo gate de dados pessoais: ${clause.title}.`,
          });
        }
        if (line.status === "failed") {
          report.issues.push({
            itemId: clause.sourceItemId,
            kind: "acervo_incompleto",
            detail: `Falha ao gravar a cláusula "${clause.title}": ${line.detail ?? "erro desconhecido"}.`,
          });
        }
      }
      report.clausesDone = true;
      await persistReport(run.id, run.report, report);
    }

    // ─── FASE 2: templates ────────────────────────────────────────────────
    const done = new Set(report.templates.map((t) => t.sourceItemId));
    const pendingTemplates = selection.templates.filter(
      (t) => !done.has(t.sourceItemId)
    );

    const budget = options.maxTemplates ?? TEMPLATES_PER_SLICE;
    // Depois da fase de cláusulas a invocação devolve o controle: ela já pode
    // ter consumido o orçamento com N transações + embeddings, e o template é o
    // passo caro. O re-encadeamento pega o próximo.
    const slice = ranClauses ? [] : pendingTemplates.slice(0, budget);

    for (const planned of slice) {
      if (Date.now() >= deadline) break;
      const line = await applyTemplate({
        orgId: run.orgId,
        template: planned,
        item: itemById.get(planned.sourceItemId) ?? null,
      });
      report.templates.push(line);
      if (line.status === "created") templatesCreated += 1;
      if (line.status === "failed") {
        report.issues.push({
          itemId: planned.sourceItemId,
          kind: "acervo_incompleto",
          detail: `Falha ao criar o modelo "${planned.name}": ${line.detail ?? "erro desconhecido"}.`,
        });
      }
      if (line.status !== "failed") {
        await markItem(run.id, planned.sourceItemId, "executed");
      }
    }

    const remaining = selection.templates.filter(
      (t) => !report!.templates.some((line) => line.sourceItemId === t.sourceItemId)
    );
    const hasMore = remaining.length > 0;

    if (!hasMore) {
      await finalize({ run, report, reviewed, now });
    } else {
      await persistReport(run.id, run.report, report);
      await prisma.ingestionRun.updateMany({
        where: { id: run.id },
        data: { itemsDone: countSettled(items, report), startedAt: null },
      });
    }

    return {
      runId: run.id,
      claimed: true,
      status: hasMore ? "executing" : "done",
      processed: clausesCreated + templatesCreated,
      templatesCreated,
      clausesCreated,
      hasMore,
      report,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingestion] execução do run ${options.runId} falhou:`, message);
    await failRun(options.runId, message);
    return { ...idleResult(options.runId, true), status: "failed", report };
  }
}

function idleResult(runId: string, claimed = false): ExecutePlanResult {
  return {
    runId,
    claimed,
    status: null,
    processed: 0,
    templatesCreated: 0,
    clausesCreated: 0,
    hasMore: false,
    report: null,
  };
}

async function failRun(runId: string, message: string): Promise<void> {
  await prisma.ingestionRun
    .updateMany({
      where: { id: runId },
      data: { status: "failed", error: message.slice(0, 500), startedAt: null },
    })
    .catch(() => {});
}

// ────────────────────────────────────────────────────────────────────────────
// Cláusulas
// ────────────────────────────────────────────────────────────────────────────

function isClauseSlot(v: string): v is ClauseSlotKey {
  return (CLAUSE_SLOT_KEYS as readonly string[]).includes(v);
}

/** Chave de variante: o par (opção do form, garantidor) dentro de um slot. */
function variantIdentity(clause: PlannedClause): string {
  const provider = normalizeVariantProvider(clause.provider) ?? "";
  return `${clause.slot}\u0000${clause.value.trim().toLowerCase()}\u0000${provider}`;
}

async function applyClause(args: {
  orgId: string;
  createdBy: string | null;
  clause: PlannedClause;
  item: ItemRow | null;
  /** Linhas já gravadas (desta e de invocações anteriores). */
  applied: readonly ExecutedClause[];
}): Promise<ExecutedClause> {
  const { clause, orgId } = args;
  const provider = normalizeVariantProvider(clause.provider);
  const base: ExecutedClause = {
    key: clauseKey(clause),
    sourceItemId: clause.sourceItemId,
    slot: clause.slot,
    value: clause.value,
    provider,
    title: clause.title,
    tags: clause.tags,
    status: "failed",
  };

  if (args.applied.some((c) => c.key === base.key && c.status === "created")) {
    // Reexecução: a cláusula já está no acervo. Regravar arquivaria a anterior
    // e criaria uma cópia — "já feito" é a resposta certa.
    return { ...base, status: "created", detail: "Já estava no acervo." };
  }
  if (!isClauseSlot(clause.slot)) {
    return { ...base, detail: `Espaço de cláusula desconhecido: ${clause.slot}.` };
  }

  const identity = variantIdentity(clause);
  const collision = args.applied.find(
    (c) =>
      c.status === "created" &&
      `${c.slot}\u0000${c.value.trim().toLowerCase()}\u0000${c.provider ?? ""}` ===
        identity
  );
  if (collision) {
    // Duas cláusulas com a MESMA opção do formulário e o MESMO garantidor são a
    // mesma linha do acervo: gravar a segunda arquivaria a primeira em silêncio.
    return {
      ...base,
      status: "duplicate_variant",
      detail: `Outra cláusula do lote já ocupa esta combinação (${clause.value}${provider ? ` · ${provider}` : ""}).`,
    };
  }

  // ─── GATE DE PII ─────────────────────────────────────────────────────────
  const findings: PiiFinding[] = detectPii(clause.content);
  if (hasBlockingPii(findings)) {
    return {
      ...base,
      status: "pii_blocked",
      piiKinds: Array.from(new Set(findings.map((f) => f.kind))),
      detail:
        "O texto ainda tem dados pessoais. Cláusula não gravada — texto com PII " +
        "ganha embedding e não dá para desfazer.",
    };
  }

  try {
    const sourceName = (args.item?.filename ?? clause.sourceItemId).replace(
      /\.(docx|pdf)$/i,
      ""
    );
    const result = await ingestSlotClauses({
      orgId,
      slot: clause.slot,
      sourceName,
      variants: [
        {
          value: clause.value,
          provider: clause.provider ?? undefined,
          title: clause.title,
          content: clause.content,
        },
      ],
      createdBy: args.createdBy,
    });
    const created = result.items[0];
    if (!created) return { ...base, detail: "A gravação não devolveu a cláusula." };

    // SUGGEST-ONLY: a cláusula nasce `pending`. `ingestSlotClauses` grava
    // `approved` (é o caminho da Central, onde o operador já revisou item a
    // item); aqui a decisão de valer na geração continua sendo do acervo
    // (/clauses), como acontece com o template, que nasce draft.
    await prisma.knowledgeItem.updateMany({
      where: { id: { in: [created.id] }, orgId },
      data: { status: "pending" },
    });

    // Embedding fora da transação e best-effort: o Voyage é externo e uma queda
    // dele não pode desfazer uma cláusula que já está gravada.
    await embedKnowledgeItem(result.embedTargets, {
      orgId,
      userId: args.createdBy,
    }).catch((err) => {
      console.warn("[ingestion] embedding da cláusula falhou (segue):", err);
    });

    return {
      ...base,
      status: "created",
      knowledgeItemId: created.id,
      title: created.title,
      tags: created.tags,
      archivedIds: created.archivedIds,
    };
  } catch (err) {
    return { ...base, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────────────────────

/** Sniff de magic header — mesmo critério de `run-executor.ts`. */
function isDocx(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

async function applyTemplate(args: {
  orgId: string;
  template: PlannedTemplate;
  item: ItemRow | null;
}): Promise<ExecutedTemplate> {
  const { template, item, orgId } = args;
  const base: ExecutedTemplate = {
    sourceItemId: template.sourceItemId,
    filename: item?.filename ?? template.sourceItemId,
    name: template.name,
    modalidade: template.modalidade,
    status: "failed",
    isDefaultSuggested: template.isDefaultSuggested === true,
  };

  if (!item) {
    return { ...base, detail: "O arquivo de origem não está mais neste lote." };
  }

  try {
    const res = await fetch(item.blobUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar o arquivo`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!isDocx(buffer)) {
      return {
        ...base,
        detail:
          "Só DOCX vira modelo — é ele que preserva o timbrado. Este arquivo não é DOCX.",
      };
    }

    const created = await ingestTemplateFromDocx({
      orgId,
      buffer,
      filename: item.filename,
      modalidade: template.modalidade,
      name: template.name,
      // `matchCriteria` passa pelo parser canônico: o plano é texto de LLM e um
      // eixo inventado ("garantia": "fianca_bancaria") viraria critério que
      // nunca casa com fato nenhum do formulário.
      matchCriteria: parseMatchCriteria(template.matchCriteria) as Record<
        string,
        unknown
      > | null,
      slotBlocks: template.slotBlocks,
    });

    return {
      ...base,
      status: "created",
      templateId: created.templateId,
      name: created.name,
      webViewLink: created.webViewLink,
      slotsApplied: created.slots.filter((s) => s.applied).map((s) => s.slot),
      detail: describeSlotOutcome(created.slots),
    };
  } catch (err) {
    if (err instanceof DuplicateTemplateError) {
      // O dedup por `sourceHash` já barrou: o arquivo virou template antes
      // (reexecução, ou o operador subiu o mesmo DOCX pela Central). Isso é
      // "já feito", não falha.
      return {
        ...base,
        status: "duplicate",
        templateId: err.existing.id,
        detail: `Este arquivo já era o modelo "${err.existing.name}".`,
      };
    }
    return { ...base, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Uma frase sobre os slots que NÃO abriram — o resto o operador vê na revisão. */
function describeSlotOutcome(
  slots: Array<{ slot: string; applied: boolean }>
): string | undefined {
  const failed = slots.filter((s) => !s.applied).map((s) => s.slot);
  if (failed.length === 0) return undefined;
  return `O espaço de ${failed.join(", ")} não abriu — o modelo ficou com a cláusula fixa.`;
}

// ────────────────────────────────────────────────────────────────────────────
// Relatório
// ────────────────────────────────────────────────────────────────────────────

function initialReport(
  plan: LibraryPlan,
  reviewed: ReviewedLibraryPlan,
  selection: ReturnType<typeof selectApproved>,
  now: Date
): ExecutionReport {
  const rejectedDiscards = new Set(
    reviewed.discards.filter((d) => !d.approved).map((d) => d.itemId)
  );
  return {
    version: EXECUTION_REPORT_VERSION,
    startedAt: now.toISOString(),
    finishedAt: null,
    reviewedBy: reviewed.reviewedBy,
    reviewedAt: reviewed.reviewedAt,
    clausesDone: false,
    clauses: [],
    templates: [],
    rejected: {
      templates: selection.rejectedTemplates.map((t) => ({
        sourceItemId: t.sourceItemId,
        name: t.name,
      })),
      clauses: selection.rejectedClauses.map((c) => ({
        key: clauseKey(c),
        title: c.title,
      })),
      discards: Array.from(rejectedDiscards),
    },
    // Descartes com que o operador concordou entram no relatório; os recusados
    // ficam em `rejected.discards` — o arquivo não virou nada, mas o relatório
    // não pode afirmar que ele foi descartado por decisão de ninguém.
    discards: plan.discards.filter((d) => !rejectedDiscards.has(d.itemId)),
    issues: [...plan.issues],
    counts: {
      templatesCreated: 0,
      clausesCreated: 0,
      piiBlocked: 0,
      failures: 0,
    },
    aiCostUsd: null,
    coverage: null,
  };
}

function recount(report: ExecutionReport): void {
  report.counts = {
    templatesCreated: report.templates.filter((t) => t.status === "created").length,
    clausesCreated: report.clauses.filter((c) => c.status === "created").length,
    piiBlocked: report.clauses.filter((c) => c.status === "pii_blocked").length,
    failures:
      report.templates.filter((t) => t.status === "failed").length +
      report.clauses.filter((c) => c.status === "failed").length,
  };
}

async function persistReport(
  runId: string,
  previousRaw: unknown,
  report: ExecutionReport
): Promise<void> {
  recount(report);
  const previous =
    previousRaw && typeof previousRaw === "object" && !Array.isArray(previousRaw)
      ? (previousRaw as Record<string, unknown>)
      : {};
  // O `grouping` da Fase A1 continua no report — o relatório final é aditivo.
  await prisma.ingestionRun.updateMany({
    where: { id: runId },
    data: { report: { ...previous, execution: report } as object },
  });
}

function countSettled(items: readonly ItemRow[], report: ExecutionReport): number {
  const touched = new Set<string>([
    ...report.templates.map((t) => t.sourceItemId),
    ...report.clauses.map((c) => c.sourceItemId),
    ...report.discards.map((d) => d.itemId),
  ]);
  return items.filter((i) => touched.has(i.id) || i.status === "error").length;
}

async function markItem(
  runId: string,
  itemId: string,
  status: "executed" | "discarded"
): Promise<void> {
  await prisma.ingestionItem
    .updateMany({ where: { id: itemId, runId }, data: { status } })
    .catch(() => {});
}

async function finalize(args: {
  run: RunRow;
  report: ExecutionReport;
  reviewed: ReviewedLibraryPlan;
  now: Date;
}): Promise<void> {
  const { run, report, now } = args;

  for (const discard of report.discards) {
    await markItem(run.id, discard.itemId, "discarded");
  }

  report.finishedAt = now.toISOString();
  report.coverage = await computeCoverageForOrg(run.orgId);
  const cost = await sumIngestionAiCost(run.orgId, run.createdAt, now);
  report.aiCostUsd = cost;
  recount(report);

  const previous =
    run.report && typeof run.report === "object" && !Array.isArray(run.report)
      ? (run.report as Record<string, unknown>)
      : {};

  const items = (await prisma.ingestionItem.findMany({
    where: { runId: run.id },
    select: { id: true, filename: true, fileKind: true, blobUrl: true, status: true },
  })) as ItemRow[];

  await prisma.ingestionRun.updateMany({
    where: { id: run.id },
    data: {
      status: "done",
      report: { ...previous, execution: report } as object,
      itemsDone: countSettled(items, report),
      itemsTotal: items.length,
      ...(cost === null ? {} : { aiCostUsd: cost }),
      startedAt: null,
      error: null,
    },
  });
}

/** Matriz modalidade × garantia depois da execução (ativos + rascunhos). */
async function computeCoverageForOrg(
  orgId: string
): Promise<GarantiaCoverageReport | null> {
  try {
    const [modules, templates] = await Promise.all([
      getOrgModules(orgId),
      prisma.contractTemplate.findMany({
        where: { orgId, status: { in: ["active", "draft"] } },
        select: {
          id: true,
          name: true,
          modalidade: true,
          status: true,
          engine: true,
          sourceHash: true,
          matchCriteria: true,
        },
      }),
    ]);
    const enabled = MODULE_CATALOG.map((m) => m.key).filter(
      (m: ModuleKey) => modules.enabled[m]
    );
    return computeGarantiaCoverage({ modules: enabled, templates: templates ?? [] });
  } catch (err) {
    // A cobertura é informação do relatório, não parte da escrita: perdê-la não
    // pode transformar um run bem-sucedido em `failed`.
    console.warn("[ingestion] não consegui calcular a cobertura do run:", err);
    return null;
  }
}

/** Custo de IA atribuído ao run — ver {@link INGESTION_AI_OPERATIONS}. */
async function sumIngestionAiCost(
  orgId: string,
  from: Date,
  to: Date
): Promise<number | null> {
  try {
    const agg = await prisma.aIUsage.aggregate({
      where: {
        orgId,
        operation: { in: [...INGESTION_AI_OPERATIONS] },
        createdAt: { gte: from, lte: to },
      },
      _sum: { estimatedCostUsd: true },
    });
    const sum = agg?._sum?.estimatedCostUsd;
    if (sum === null || sum === undefined) return null;
    return Number(sum);
  } catch (err) {
    console.warn("[ingestion] não consegui somar o custo de IA do run:", err);
    return null;
  }
}
