"use client";

/**
 * Conferência de um lote de ingestão — a tela onde a proposta do planner vira
 * (ou não) biblioteca da imobiliária.
 *
 * ## O desenho (revisto no lote de 20 da Ativa)
 *
 * A primeira versão despejava tudo aberto: 12 avisos no topo, 10 modelos com
 * preview e justificativa expandidos, 6 cláusulas com texto — uma parede. O
 * operador de onboarding precisa DECIDIR, não ler um relatório:
 *
 * - cards por MODALIDADE, recolhidos; o fechado mostra só o que decide (nome,
 *   critérios, chips de slot/aviso);
 * - aviso que pertence a um arquivo mora DENTRO do card dele; no topo ficam só
 *   os globais e os bloqueantes;
 * - erro de run vem TRADUZIDO (`run-error-humanize`) com um "Tentar de novo"
 *   que reaproveita extração e classificação pagas — nunca payload cru, nunca
 *   "envie tudo de novo";
 * - a espera mostra o progresso POR FAMÍLIA do fanout, não uma barra genérica;
 * - o operador pode comentar (por modelo ou geral) e REPROCESSAR com as
 *   instruções, vendo o custo antes; pode marcar a instrução como permanente;
 * - pode SUBSTITUIR o arquivo de um modelo (a minuta em branco no lugar do
 *   contrato preenchido) sem jogar o lote fora;
 * - os arquivos que ficaram fora da análise (dedup do intake, substituídos)
 *   aparecem com o motivo — subir 20 e ver um plano de 14 sem explicação era
 *   um buraco de confiança.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upload } from "@vercel/blob/client";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Layers,
  Loader2,
  MessageSquarePlus,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  matchCriteriaSummary,
  modalidadeLabel,
} from "@/lib/contracts/template-category";
import { slotLabel, type ClauseSlotKey } from "@/lib/templates/clause-slots";
import {
  BLOCKING_ISSUE_KINDS,
  DISCARD_REASON_LABELS,
  ISSUE_KIND_LABELS,
  buildReviewedPlan,
  clauseKey,
  countApproved,
  defaultDecisions,
  parseLibraryPlan,
  setAllDecisions,
  templateKey,
  type PlanDecisions,
} from "@/lib/ingestion/plan-review";
import {
  CLAUSE_STATUS_LABELS,
  TEMPLATE_STATUS_LABELS,
  readExecutionReport,
} from "@/lib/ingestion/execution-report";
import { humanizeRunError } from "@/lib/ingestion/run-error-humanize";
import { PLAN_FAMILY_LABELS } from "@/lib/ingestion/plan-fanout";
import type { PlanIssue } from "@/lib/ingestion/library-plan";
import type { GarantiaCoverageReport } from "@/lib/templates/coverage";

export interface IngestionRunItem {
  id: string;
  filename: string;
  fileKind: string;
  status: string;
  error: string | null;
  blobUrl?: string | null;
  classification?: unknown;
}

export interface IngestionRunSnapshot {
  id: string;
  trigger: string;
  status: string;
  itemsTotal: number;
  itemsDone: number;
  error: string | null;
  libraryPlan: unknown;
  planReviewed: unknown;
  report: unknown;
  aiCostUsd?: number | string | null;
  items: IngestionRunItem[];
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Na fila",
  extracting: "Lendo os arquivos",
  classifying: "Entendendo o que é cada um",
  grouping: "Agrupando os parecidos",
  planning: "Montando a proposta da biblioteca",
  awaiting_review: "Esperando a sua conferência",
  executing: "Aplicando o que você aprovou",
  done: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

/** Estágios em que o servidor ainda está trabalhando — a tela faz polling. */
const LIVE_STATUSES = [
  "queued",
  "extracting",
  "classifying",
  "grouping",
  "planning",
  "executing",
];

const POLL_MS = 4000;

/** Estado mínimo de uma família do fanout, lido do report (client-safe). */
interface FamilyProgressState {
  nextStepIndex: number | null;
  accepted: boolean;
  itemCount: number;
}

export function IngestionReviewClient({
  initialRun,
  orgId,
}: {
  initialRun: IngestionRunSnapshot;
  /** Prefixo do Blob — o token de upload só sai para `ingestion/<orgId>/…`. */
  orgId: string;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [decisions, setDecisions] = useState<PlanDecisions | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const plan = useMemo(() => parseLibraryPlan(run.libraryPlan), [run.libraryPlan]);
  const execution = useMemo(() => readExecutionReport(run.report), [run.report]);

  const itemById = useMemo(
    () => new Map(run.items.map((i) => [i.id, i])),
    [run.items]
  );
  const filenameOf = useCallback(
    (itemId: string | null) =>
      itemById.get(itemId ?? "")?.filename ?? "arquivo removido do lote",
    [itemById]
  );

  // As decisões nascem do plano (tudo marcado) e só são recriadas quando o
  // plano em si muda — o polling não pode desfazer o que o operador desmarcou.
  useEffect(() => {
    if (!plan) return;
    setDecisions((prev) => prev ?? defaultDecisions(plan));
  }, [plan]);

  // Plano novo (replan/reanexo) = decisões novas.
  const planRef = useRef(run.libraryPlan);
  useEffect(() => {
    if (planRef.current !== run.libraryPlan) {
      planRef.current = run.libraryPlan;
      setDecisions(plan ? defaultDecisions(plan) : null);
    }
  }, [run.libraryPlan, plan]);

  useEffect(() => {
    if (!LIVE_STATUSES.includes(run.status)) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/templates/ingest/runs/${run.id}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Falha ao consultar o lote");
        const next = (await res.json()) as IngestionRunSnapshot;
        if (!alive) return;
        setPollError(null);
        setRun((current) => ({ ...current, ...next }));
      } catch (err) {
        if (alive) {
          setPollError(err instanceof Error ? err.message : "Falha ao atualizar");
        }
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [run.id, run.status]);

  const counts = decisions
    ? countApproved(decisions)
    : { templates: 0, clauses: 0, total: 0 };

  async function submit() {
    if (!plan || !decisions) return;
    setSubmitting(true);
    try {
      // `reviewedBy`/`reviewedAt` são carimbados pelo servidor.
      const reviewed = buildReviewedPlan(plan, decisions, {
        reviewedBy: "",
        reviewedAt: "",
      });
      const res = await fetch(`/api/templates/ingest/runs/${run.id}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templates: reviewed.templates,
          clauses: reviewed.clauses,
          discards: reviewed.discards,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Falha ao aplicar o plano");
      setRun((current) => ({ ...current, status: data.status ?? "executing" }));
      toast.success("Aplicando — os modelos entram como rascunho para você revisar.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao aplicar o plano");
    } finally {
      setSubmitting(false);
    }
  }

  async function replan(body: {
    comments?: string[];
    notes?: string[];
  }): Promise<void> {
    const res = await fetch(`/api/templates/ingest/runs/${run.id}/replan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Falha ao reprocessar");
    setComments({});
    setDecisions(null);
    setRun((current) => ({ ...current, status: "planning", error: null }));
  }

  const pct =
    run.itemsTotal > 0
      ? Math.min(100, Math.round((run.itemsDone / run.itemsTotal) * 100))
      : 0;

  const humanError = humanizeRunError(run.error);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={run.status === "failed" ? "destructive" : "secondary"}>
              {STATUS_LABELS[run.status] ?? run.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {run.itemsDone} de {run.itemsTotal} arquivo(s)
            </span>
            {LIVE_STATUSES.includes(run.status) && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <CostBadge aiCostUsd={run.aiCostUsd} />
          </div>
          <Progress value={pct} />
          {run.status === "planning" && <FamilyProgress report={run.report} />}
          {pollError && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Não consegui atualizar agora ({pollError}). O lote continua rodando no
              servidor — esta tela volta a acompanhar sozinha.
            </p>
          )}
          {run.status === "failed" && humanError && (
            <div className="space-y-2 rounded-md bg-destructive/10 px-3 py-2.5">
              <p className="text-sm font-medium text-destructive">
                {humanError.message}
              </p>
              <p className="text-xs text-muted-foreground">{humanError.action}</p>
              {humanError.retryable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void replan({}).then(
                      () => toast.success("Reanalisando — nada precisou ser reenviado."),
                      (err) =>
                        toast.error(
                          err instanceof Error ? err.message : "Falha ao reprocessar"
                        )
                    )
                  }
                >
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                  Tentar de novo
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <SuggestOnlyNotice />

      {execution ? (
        <ExecutionReportView report={execution} filenameOf={filenameOf} />
      ) : run.status === "executing" ? (
        <EmptyState
          icon={<Loader2 className="h-5 w-5 animate-spin" />}
          title="Aplicando o que você aprovou"
          detail="As cláusulas entram primeiro no acervo e os modelos vêm depois, em levas. Pode fechar esta tela — o servidor termina sozinho."
        />
      ) : !plan ? (
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title={
            run.status === "failed"
              ? "Este lote ainda não tem uma proposta"
              : "A proposta ainda está sendo montada"
          }
          detail={
            run.status === "failed"
              ? "Nada foi criado na sua biblioteca. Use o “Tentar de novo” acima — os arquivos e a leitura já feita ficam guardados."
              : "Assim que terminarmos de ler e agrupar os arquivos, a proposta aparece aqui para você conferir."
          }
        />
      ) : (
        <PlanReview
          orgId={orgId}
          run={run}
          plan={plan}
          decisions={decisions}
          setDecisions={setDecisions}
          submitting={submitting}
          counts={counts}
          comments={comments}
          setComments={setComments}
          filenameOf={filenameOf}
          itemById={itemById}
          onSubmit={() => void submit()}
          onReplan={replan}
          onReattached={() => {
            setDecisions(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Revisão do plano
// ────────────────────────────────────────────────────────────────────────────

function PlanReview({
  orgId,
  run,
  plan,
  decisions,
  setDecisions,
  submitting,
  counts,
  comments,
  setComments,
  filenameOf,
  itemById,
  onSubmit,
  onReplan,
  onReattached,
}: {
  orgId: string;
  run: IngestionRunSnapshot;
  plan: NonNullable<ReturnType<typeof parseLibraryPlan>>;
  decisions: PlanDecisions | null;
  setDecisions: React.Dispatch<React.SetStateAction<PlanDecisions | null>>;
  submitting: boolean;
  counts: { templates: number; clauses: number; total: number };
  comments: Record<string, string>;
  setComments: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  filenameOf: (id: string | null) => string;
  itemById: Map<string, IngestionRunItem>;
  onSubmit: () => void;
  onReplan: (body: { comments?: string[]; notes?: string[] }) => Promise<void>;
  onReattached: () => void;
}) {
  const reviewing = run.status === "awaiting_review";

  // Avisos por arquivo moram no card do arquivo; no topo, só os globais e os
  // bloqueantes — é a diferença entre "leia tudo" e "olhe onde importa".
  const issuesByItem = useMemo(() => {
    const map = new Map<string, PlanIssue[]>();
    for (const issue of plan.issues) {
      if (!issue.itemId || BLOCKING_ISSUE_KINDS.includes(issue.kind)) continue;
      const list = map.get(issue.itemId) ?? [];
      list.push(issue);
      map.set(issue.itemId, list);
    }
    return map;
  }, [plan.issues]);
  const topIssues = plan.issues.filter(
    (i) => !i.itemId || BLOCKING_ISSUE_KINDS.includes(i.kind)
  );

  const byModalidade = useMemo(() => {
    const groups = new Map<string, typeof plan.templates>();
    for (const t of plan.templates) {
      const list = groups.get(t.modalidade) ?? [];
      list.push(t);
      groups.set(t.modalidade, list);
    }
    return [...groups.entries()];
  }, [plan]);

  const outOfAnalysis = useMemo(
    () =>
      run.items
        .filter((i) => i.status === "discarded")
        .map((i) => {
          const c = (i.classification ?? {}) as { via?: string; reason?: string };
          return c.via === "intake" || c.via === "operator"
            ? { item: i, reason: c.reason ?? "Fora desta análise." }
            : null;
        })
        .filter((x): x is { item: IngestionRunItem; reason: string } => x !== null),
    [run.items]
  );

  const setComment = (key: string, text: string) =>
    setComments((prev) => ({ ...prev, [key]: text }));

  return (
    <>
      <IssueList issues={topIssues} filenameOf={filenameOf} />

      {byModalidade.map(([modalidade, templates]) => (
        <Section
          key={modalidade}
          title={`Modelos — ${modalidadeLabel(modalidade)}`}
          count={templates.length}
          icon={<FileText className="h-4 w-4" />}
          hint="Um modelo por garantia. Clique no nome para ver os detalhes."
        >
          {templates.map((t) => {
            const key = templateKey(t);
            const item = itemById.get(t.sourceItemId);
            const itemIssues = issuesByItem.get(t.sourceItemId) ?? [];
            const criteria = matchCriteriaSummary(t.matchCriteria);
            const slots = Object.entries(t.slotBlocks ?? {}).filter(
              ([, paragraphs]) => (paragraphs ?? []).length > 0
            );
            return (
              <CollapsibleCard
                key={key}
                kind="modelo"
                checked={decisions?.templates[key] ?? false}
                disabled={submitting || !reviewing}
                onChange={(v) =>
                  setDecisions((prev) =>
                    prev
                      ? { ...prev, templates: { ...prev.templates, [key]: v } }
                      : prev
                  )
                }
                title={t.name}
                subtitle={filenameOf(t.sourceItemId)}
                chips={
                  <>
                    {criteria.map((c) => (
                      <Badge key={c} variant="outline" className="text-[11px]">
                        {c}
                      </Badge>
                    ))}
                    {slots.length > 0 && (
                      <Badge
                        variant="outline"
                        className="border-violet-300 text-[11px] text-violet-700 dark:border-violet-800 dark:text-violet-300"
                      >
                        abre espaço de cláusula
                      </Badge>
                    )}
                    {t.isDefaultSuggested && (
                      <Badge variant="secondary" className="text-[11px]">
                        sugerido como principal
                      </Badge>
                    )}
                    {itemIssues.length > 0 && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-300"
                      >
                        {itemIssues.length} aviso(s)
                      </Badge>
                    )}
                  </>
                }
              >
                {criteria.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Sem critério de escolha — este modelo só é usado como padrão da
                    modalidade.
                  </p>
                )}
                {slots.map(([slot, paragraphs]) => (
                  <div
                    key={slot}
                    className="rounded-md border border-violet-300 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/20"
                  >
                    <p className="text-[11px] font-medium">
                      Abre espaço reutilizável:{" "}
                      {slotLabel(slot as ClauseSlotKey).toLowerCase()}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      Este trecho SAI do corpo do modelo e a cláusula certa entra na
                      hora de gerar o contrato:
                    </p>
                    <p className="mt-1 rounded bg-background px-2 py-1.5 text-[11px] leading-snug">
                      {preview((paragraphs ?? []).join(" "), 260)}
                    </p>
                  </div>
                ))}
                {itemIssues.map((issue, i) => (
                  <p
                    key={i}
                    className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug dark:bg-amber-950/30"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                    <span>
                      <strong>{ISSUE_KIND_LABELS[issue.kind] ?? issue.kind}:</strong>{" "}
                      {issue.detail}
                    </span>
                  </p>
                ))}
                <Rationale text={t.rationale} />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {item?.blobUrl && (
                    <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                      <a href={item.blobUrl} target="_blank" rel="noreferrer">
                        <Download className="mr-1 h-3 w-3" />
                        Ver arquivo original
                      </a>
                    </Button>
                  )}
                  {reviewing && (
                    <ReplaceFileButton
                      runId={run.id}
                      orgId={orgId}
                      replaceItemId={t.sourceItemId}
                      onDone={onReattached}
                    />
                  )}
                </div>
                {reviewing && (
                  <CommentBox
                    value={comments[key] ?? ""}
                    onChange={(text) => setComment(key, text)}
                    placeholder={`Instrução sobre "${t.name}" para a próxima análise…`}
                  />
                )}
              </CollapsibleCard>
            );
          })}
        </Section>
      ))}

      <Section
        title="Cláusulas propostas"
        count={plan.clauses.length}
        icon={<Layers className="h-4 w-4" />}
        hint="A redação por fornecedor que entra no espaço do modelo ao gerar o contrato."
      >
        {plan.clauses.map((c) => {
          const key = clauseKey(c);
          return (
            <CollapsibleCard
              key={key}
              kind="clausula"
              checked={decisions?.clauses[key] ?? false}
              disabled={submitting || !reviewing}
              onChange={(v) =>
                setDecisions((prev) =>
                  prev ? { ...prev, clauses: { ...prev.clauses, [key]: v } } : prev
                )
              }
              title={c.title}
              subtitle={`${slotLabel(c.slot)} · ${c.value}${
                c.provider ? ` · ${c.provider}` : " · vale para qualquer fornecedor"
              }`}
              chips={
                <>
                  {c.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[11px]">
                      {tag}
                    </Badge>
                  ))}
                </>
              }
            >
              <p className="rounded bg-muted/40 px-2 py-1.5 text-[11px] leading-snug">
                {preview(c.content, 480)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Fonte: {filenameOf(c.sourceItemId)}
              </p>
              <Rationale text={c.rationale} />
            </CollapsibleCard>
          );
        })}
      </Section>

      <Section
        title="Arquivos descartados"
        count={plan.discards.length}
        icon={<Trash2 className="h-4 w-4" />}
        hint="Desmarque um descarte para registrar que você discorda."
      >
        {plan.discards.map((d) => (
          <CollapsibleCard
            key={d.itemId}
            kind="descarte"
            checked={decisions?.discards[d.itemId] ?? true}
            disabled={submitting || !reviewing}
            onChange={(v) =>
              setDecisions((prev) =>
                prev
                  ? { ...prev, discards: { ...prev.discards, [d.itemId]: v } }
                  : prev
              )
            }
            title={filenameOf(d.itemId)}
            subtitle={DISCARD_REASON_LABELS[d.reason] ?? d.reason}
          >
            <p className="text-[11px] text-muted-foreground">{d.detail}</p>
          </CollapsibleCard>
        ))}
      </Section>

      {outOfAnalysis.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold">
              Já estavam na biblioteca{" "}
              <span className="text-muted-foreground">({outOfAnalysis.length})</span>
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Estes arquivos ficaram fora da análise — nada a fazer com eles.
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {outOfAnalysis.map(({ item, reason }) => (
              <li key={item.id} className="rounded-md border border-dashed px-3 py-2">
                <span className="font-medium text-foreground">{item.filename}</span> —{" "}
                {reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {reviewing && (
        <ReplanPanel
          run={run}
          plan={plan}
          comments={comments}
          setComments={setComments}
          onReplan={onReplan}
        />
      )}

      {reviewing && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 py-3 backdrop-blur">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => setDecisions(setAllDecisions(plan, true))}
          >
            Aprovar tudo
          </Button>
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => setDecisions(setAllDecisions(plan, false))}
          >
            Desmarcar tudo
          </Button>
          <Button
            className="ml-auto"
            disabled={submitting || counts.total === 0}
            onClick={onSubmit}
          >
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Aplicar {counts.templates} modelo(s) e {counts.clauses} cláusula(s)
          </Button>
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Reprocessar com instruções
// ────────────────────────────────────────────────────────────────────────────

function ReplanPanel({
  run,
  plan,
  comments,
  setComments,
  onReplan,
}: {
  run: IngestionRunSnapshot;
  plan: NonNullable<ReturnType<typeof parseLibraryPlan>>;
  comments: Record<string, string>;
  setComments: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onReplan: (body: { comments?: string[]; notes?: string[] }) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [persist, setPersist] = useState(false);

  // Comentários por card viram instrução nomeada COM o arquivo de origem —
  // é o nome do arquivo que permite ao fanout rotear a instrução só para a
  // família dona (routeOperatorComments); o geral entra como está.
  const collected = useMemo(() => {
    const itemsById = new Map(run.items.map((i) => [i.id, i]));
    const list: string[] = [];
    for (const t of plan.templates) {
      const text = (comments[templateKey(t)] ?? "").trim();
      if (!text) continue;
      const filename = itemsById.get(t.sourceItemId)?.filename;
      list.push(
        filename
          ? `Sobre o modelo "${t.name}" (arquivo "${filename}"): ${text}`
          : `Sobre o modelo "${t.name}": ${text}`
      );
    }
    const general = (comments.__general ?? "").trim();
    if (general) list.push(general);
    return list;
  }, [comments, plan.templates, run.items]);

  async function go() {
    setBusy(true);
    try {
      await onReplan({
        comments: collected,
        ...(persist && (comments.__general ?? "").trim()
          ? { notes: [(comments.__general ?? "").trim()] }
          : {}),
      });
      toast.success("Reanalisando com as suas instruções.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao reprocessar");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const spent = run.aiCostUsd === null || run.aiCostUsd === undefined
    ? null
    : Number(run.aiCostUsd);

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <MessageSquarePlus className="h-4 w-4" />
        <h2 className="text-sm font-semibold">Algo não ficou como devia?</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Escreva a instrução (aqui ou dentro do card de um modelo) e reprocessa: os
        arquivos não são reenviados — só a decisão é refeita, seguindo o que você
        disser.
      </p>
      <textarea
        className="w-full rounded-md border bg-background px-2.5 py-2 text-xs"
        rows={2}
        placeholder="Ex.: a caução comercial deve virar modelo próprio, não cláusula."
        value={comments.__general ?? ""}
        onChange={(e) =>
          setComments((prev) => ({ ...prev, __general: e.target.value }))
        }
      />
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => setPersist(e.target.checked)}
        />
        Lembrar desta instrução nos próximos lotes desta imobiliária
      </label>
      {!confirming ? (
        <Button
          size="sm"
          variant="outline"
          disabled={collected.length === 0}
          onClick={() => setConfirming(true)}
        >
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          Reprocessar com instruções
        </Button>
      ) : (
        <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
          <p className="text-xs">
            A reanálise custa cerca de <strong>US$ 0,40–0,60 por tipo de
            contrato</strong> do lote
            {spent !== null && (
              <>
                {" "}
                (este lote já gastou <strong>US$ {spent.toFixed(2)}</strong>)
              </>
            )}
            . {collected.length} instrução(ões) serão consideradas.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void go()}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Confirmar reanálise
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Substituir arquivo de um modelo
// ────────────────────────────────────────────────────────────────────────────

function ReplaceFileButton({
  runId,
  orgId,
  replaceItemId,
  onDone,
}: {
  runId: string;
  orgId: string;
  replaceItemId: string;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blob = await upload(`ingestion/${orgId}/${Date.now()}-${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/templates/ingest/runs/blob-upload",
        contentType: file.type || "application/octet-stream",
      });
      const res = await fetch(`/api/templates/ingest/runs/${runId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          replaceItemId,
          files: [
            {
              filename: file.name,
              fileKind: /\.pdf$/i.test(file.name) ? "pdf" : "docx",
              blobUrl: blob.url,
              sourceHash: await sha256Hex(file),
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Falha ao substituir o arquivo");
      toast.success(
        "Arquivo anexado — o lote está sendo reanalisado com ele no lugar."
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao substituir o arquivo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.pdf"
        className="hidden"
        onChange={(e) => void handlePick(e)}
      />
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <RefreshCcw className="mr-1 h-3 w-3" />
        )}
        Substituir arquivo
      </Button>
    </>
  );
}

/** Mesmo hash do intake (`StartIngestionRunButton`): governa só a SUGESTÃO. */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ────────────────────────────────────────────────────────────────────────────
// Blocos
// ────────────────────────────────────────────────────────────────────────────

/** Progresso por família do fanout, lido de `report.planning.families`. */
function FamilyProgress({ report }: { report: unknown }) {
  const families = useMemo(() => {
    const planning = (report as { planning?: { families?: unknown } } | null)
      ?.planning;
    const raw = planning?.families;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    return Object.entries(raw as Record<string, FamilyProgressState>).map(
      ([key, st]) => ({
        key,
        label: PLAN_FAMILY_LABELS[key] ?? key,
        done: st.nextStepIndex === null,
        itemCount: st.itemCount ?? 0,
      })
    );
  }, [report]);
  if (families.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {families.map((f) => (
        <span
          key={f.key}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {f.done ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          {f.label} ({f.itemCount})
        </span>
      ))}
    </div>
  );
}

function CostBadge({ aiCostUsd }: { aiCostUsd: number | string | null | undefined }) {
  if (aiCostUsd === null || aiCostUsd === undefined) return null;
  const value = Number(aiCostUsd);
  if (!Number.isFinite(value) || value <= 0) return null;
  return (
    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
      análise: US$ {value.toFixed(2)}
    </span>
  );
}

function SuggestOnlyNotice() {
  return (
    <details className="rounded-lg border border-violet-300 bg-violet-50/50 p-3 text-xs leading-snug dark:border-violet-900 dark:bg-violet-950/20">
      <summary className="cursor-pointer font-medium">
        Nada entra no ar sozinho — tudo nasce como rascunho.{" "}
        <span className="font-normal text-muted-foreground">Como ativar depois?</span>
      </summary>
      <ActivationOrder />
    </details>
  );
}

/**
 * A ordem NÃO é decorativa: o modelo com espaço de cláusula não carrega a
 * redação no corpo — quem a devolve na geração é o acervo, e só cláusula
 * aprovada conta. A ativação tem trava pra isso; o aviso existe pra ela nunca
 * precisar aparecer.
 */
function ActivationOrder() {
  return (
    <ol className="mt-2 space-y-1 text-muted-foreground">
      <li>
        <strong>1.</strong> Aprove a cláusula no{" "}
        <Link href="/clauses" className="font-medium underline">
          acervo de cláusulas
        </Link>{" "}
        — é ela que entra no espaço do modelo na hora de gerar o contrato.
      </li>
      <li>
        <strong>2.</strong> Só então ative o modelo (Modelos → abrir → “Ativar
        template”). Na ordem inversa, o contrato sai com o texto padrão da plataforma
        no lugar da redação de vocês.
      </li>
    </ol>
  );
}

function IssueList({
  issues,
  filenameOf,
}: {
  issues: PlanIssue[];
  filenameOf: (id: string | null) => string;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-2">
      {issues.map((issue, i) => {
        const blocking = BLOCKING_ISSUE_KINDS.includes(issue.kind);
        return (
          <div
            key={`${issue.kind}-${i}`}
            className={
              blocking
                ? "flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
                : "flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs"
            }
          >
            {blocking ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium">
                {ISSUE_KIND_LABELS[issue.kind] ?? issue.kind}
                {issue.itemId ? ` · ${filenameOf(issue.itemId)}` : ""}
              </p>
              <p className="mt-0.5 text-muted-foreground">{issue.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Section({
  title,
  count,
  icon,
  hint,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">
          {title} <span className="text-muted-foreground">({count})</span>
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Nada aqui neste lote.
        </p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
    </section>
  );
}

/**
 * Card recolhido por padrão: fechado mostra o que DECIDE (checkbox, nome,
 * chips); aberto mostra o resto. É o que transforma 10 modelos numa lista
 * escaneável em vez de uma parede.
 */
const KIND_STYLE: Record<string, { label: string; className: string }> = {
  modelo: {
    label: "MODELO",
    className: "border-l-4 border-l-emerald-500 dark:border-l-emerald-600",
  },
  clausula: {
    label: "CLÁUSULA",
    className: "border-l-4 border-l-violet-500 dark:border-l-violet-600",
  },
  descarte: { label: "DESCARTE", className: "border-l-4 border-l-zinc-300" },
};

function CollapsibleCard({
  checked,
  disabled,
  onChange,
  title,
  subtitle,
  kind,
  chips,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  title: string;
  subtitle: string;
  /** Identidade visual do card: o operador precisa saber O QUE está aprovando. */
  kind?: "modelo" | "clausula" | "descarte";
  chips?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const style = kind ? KIND_STYLE[kind] : null;
  return (
    <li className={`rounded-lg border p-3 ${style?.className ?? ""}`}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex items-center gap-1.5">
            {style && (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold tracking-wide text-muted-foreground">
                {style.label}
              </span>
            )}
            <span className="block truncate text-sm font-medium">{title}</span>
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </span>
          <span className="block text-xs text-muted-foreground">{subtitle}</span>
        </button>
      </div>
      {chips && <div className="mt-1.5 flex flex-wrap gap-1 pl-6">{chips}</div>}
      {open && children && <div className="mt-2 space-y-1.5 pl-6">{children}</div>}
    </li>
  );
}

function CommentBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
}) {
  return (
    <textarea
      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-[11px]"
      rows={1}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Rationale({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
      <span>{text}</span>
    </p>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Relatório final
// ────────────────────────────────────────────────────────────────────────────

function ExecutionReportView({
  report,
  filenameOf,
}: {
  report: NonNullable<ReturnType<typeof readExecutionReport>>;
  filenameOf: (id: string | null) => string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Modelos criados" value={report.counts.templatesCreated} />
        <Stat label="Cláusulas no acervo" value={report.counts.clausesCreated} />
        <Stat label="Barradas por dado pessoal" value={report.counts.piiBlocked} />
        <Stat label="Falhas" value={report.counts.failures} />
      </div>

      {report.aiCostUsd !== null && (
        <p className="text-xs text-muted-foreground">
          Custo de IA deste lote: US$ {report.aiCostUsd.toFixed(4)} (leitura dos
          arquivos, classificação e parametrização dos modelos).
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Modelos</h2>
        <ul className="space-y-2">
          {report.templates.map((t) => (
            <li key={t.sourceItemId} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <ResultIcon ok={t.status !== "failed"} />
                <span className="font-medium">{t.name}</span>
                <Badge variant="outline" className="text-[11px]">
                  {TEMPLATE_STATUS_LABELS[t.status]}
                </Badge>
                {t.templateId && (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/templates/${t.templateId}/review`}>
                      Revisar e ativar
                    </Link>
                  </Button>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {modalidadeLabel(t.modalidade)} · {t.filename}
              </p>
              {t.detail && <p className="mt-1 text-xs">{t.detail}</p>}
              {t.isDefaultSuggested && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Sugerimos este como o principal da modalidade — a marcação só
                  acontece quando você ativar o modelo.
                </p>
              )}
            </li>
          ))}
          {report.templates.length === 0 && (
            <li className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Nenhum modelo foi aplicado neste lote.
            </li>
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Cláusulas</h2>
        <ul className="space-y-2">
          {report.clauses.map((c) => (
            <li key={c.key} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <ResultIcon ok={c.status === "created"} />
                <span className="font-medium">{c.title}</span>
                <Badge
                  variant={c.status === "pii_blocked" ? "destructive" : "outline"}
                  className="text-[11px]"
                >
                  {CLAUSE_STATUS_LABELS[c.status]}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {filenameOf(c.sourceItemId)}
                {c.provider ? ` · ${c.provider}` : ""}
              </p>
              {c.detail && <p className="mt-1 text-xs">{c.detail}</p>}
              {(c.archivedIds?.length ?? 0) > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Substituiu {c.archivedIds!.length} cláusula(s) anterior(es) com as
                  mesmas etiquetas — as antigas foram arquivadas, não apagadas.
                </p>
              )}
            </li>
          ))}
          {report.clauses.length === 0 && (
            <li className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Nenhuma cláusula foi gravada neste lote.
            </li>
          )}
        </ul>
      </section>

      {(report.rejected.templates.length > 0 ||
        report.rejected.clauses.length > 0 ||
        report.rejected.discards.length > 0) && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Recusado na conferência</h2>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {report.rejected.templates.map((t) => (
              <li key={t.sourceItemId}>Modelo “{t.name}” — não foi criado.</li>
            ))}
            {report.rejected.clauses.map((c) => (
              <li key={c.key}>Cláusula “{c.title}” — não foi para o acervo.</li>
            ))}
            {report.rejected.discards.map((id) => (
              <li key={id}>
                Você não concordou em descartar {filenameOf(id)} — ele não virou nada
                nesta rodada.
              </li>
            ))}
          </ul>
        </section>
      )}

      {(report.intakeDiscards?.length ?? 0) > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Já estavam na biblioteca</h2>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {report.intakeDiscards!.map((d) => (
              <li key={d.itemId}>
                {d.filename} — {d.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.discards.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Descartes</h2>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {report.discards.map((d, i) => (
              <li key={`${d.itemId}-${i}`}>
                {filenameOf(d.itemId)} — {DISCARD_REASON_LABELS[d.reason] ?? d.reason}.{" "}
                {d.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.issues.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Avisos</h2>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {report.issues.map((issue, i) => (
              <li key={`${issue.kind}-${i}`}>
                {ISSUE_KIND_LABELS[issue.kind] ?? issue.kind}
                {issue.itemId ? ` · ${filenameOf(issue.itemId)}` : ""} — {issue.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.templates.some((t) => (t.slotsApplied?.length ?? 0) > 0) && (
        <section className="space-y-1 rounded-lg border border-violet-300 bg-violet-50/50 p-3 text-xs dark:border-violet-900 dark:bg-violet-950/20">
          <p className="font-medium">Para começar a valer, nesta ordem:</p>
          <ActivationOrder />
        </section>
      )}

      {report.coverage && <CoverageMatrix coverage={report.coverage} />}
    </div>
  );
}

function CoverageMatrix({ coverage }: { coverage: GarantiaCoverageReport }) {
  if (coverage.rows.length === 0) return null;
  const symbol: Record<string, string> = {
    active: "✓",
    draft: "•",
    missing: "—",
  };
  const title: Record<string, string> = {
    active: "Ativo — já gera contrato",
    draft: "Rascunho — falta revisar e ativar",
    missing: "Ainda não existe",
  };
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">O que a sua biblioteca cobre agora</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left font-medium">Modalidade</th>
              {coverage.garantias.map((g) => (
                <th key={g} className="p-2 text-center font-medium">
                  {g.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverage.rows.map((row) => (
              <tr key={row.modalidade} className="border-t">
                <td className="p-2">{row.label}</td>
                {row.cells.map((cell) => (
                  <td
                    key={cell.garantia}
                    className="p-2 text-center"
                    title={`${cell.label}: ${title[cell.state]}`}
                  >
                    {symbol[cell.state]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        ✓ ativo · • rascunho (falta revisar e ativar) · — ainda não existe.
        {coverage.gaps.length > 0 &&
          ` Faltam ${coverage.gaps.length} combinação(ões) nas modalidades que vocês já usam.`}
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ResultIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
  ) : (
    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
  );
}

function preview(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
