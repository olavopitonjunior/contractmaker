"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Layers,
  Loader2,
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
import type { GarantiaCoverageReport } from "@/lib/templates/coverage";

export interface IngestionRunItem {
  id: string;
  filename: string;
  fileKind: string;
  status: string;
  error: string | null;
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

export function IngestionReviewClient({
  initialRun,
}: {
  initialRun: IngestionRunSnapshot;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [decisions, setDecisions] = useState<PlanDecisions | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const plan = useMemo(() => parseLibraryPlan(run.libraryPlan), [run.libraryPlan]);
  const execution = useMemo(() => readExecutionReport(run.report), [run.report]);

  const filenameOf = useCallback(
    (itemId: string | null) =>
      run.items.find((i) => i.id === itemId)?.filename ?? "arquivo removido do lote",
    [run.items]
  );

  // As decisões nascem do plano (tudo marcado) e só são recriadas quando o
  // plano em si muda — o polling não pode desfazer o que o operador desmarcou.
  useEffect(() => {
    if (!plan) return;
    setDecisions((prev) => prev ?? defaultDecisions(plan));
  }, [plan]);

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
      // `reviewedBy`/`reviewedAt` são carimbados pelo servidor; aqui só as
      // decisões viajam.
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

  const pct =
    run.itemsTotal > 0
      ? Math.min(100, Math.round((run.itemsDone / run.itemsTotal) * 100))
      : 0;

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
          </div>
          <Progress value={pct} />
          {pollError && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Não consegui atualizar agora ({pollError}). O lote continua rodando no
              servidor — esta tela volta a acompanhar sozinha.
            </p>
          )}
          {run.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {run.error}
            </p>
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
          detail="As cláusulas entram primeiro no acervo e os modelos vêm depois, um por vez. Pode fechar esta tela — o servidor termina sozinho."
        />
      ) : !plan ? (
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title={
            run.status === "failed"
              ? "Este lote não chegou a ter uma proposta"
              : "A proposta ainda está sendo montada"
          }
          detail={
            run.status === "failed"
              ? "Nada foi criado na sua biblioteca. Envie os arquivos de novo para tentar outra vez."
              : "Assim que terminarmos de ler e agrupar os arquivos, a proposta aparece aqui para você conferir."
          }
        />
      ) : (
        <>
          <IssueList plan={plan} filenameOf={filenameOf} />

          <Section
            title="Modelos propostos"
            count={plan.templates.length}
            icon={<FileText className="h-4 w-4" />}
            hint="Cada modelo nasce como rascunho. Garantia diferente é modelo diferente — é o que faz o sistema escolher o certo a partir do formulário."
          >
            {plan.templates.map((t) => {
              const key = templateKey(t);
              const criteria = matchCriteriaSummary(t.matchCriteria);
              const slots = Object.entries(t.slotBlocks ?? {}).filter(
                ([, paragraphs]) => (paragraphs ?? []).length > 0
              );
              return (
                <ReviewRow
                  key={key}
                  checked={decisions?.templates[key] ?? false}
                  disabled={submitting || run.status !== "awaiting_review"}
                  onChange={(v) =>
                    setDecisions((prev) =>
                      prev
                        ? { ...prev, templates: { ...prev.templates, [key]: v } }
                        : prev
                    )
                  }
                  title={t.name}
                  subtitle={`${modalidadeLabel(t.modalidade)} · ${filenameOf(t.sourceItemId)}`}
                >
                  {criteria.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {criteria.map((c) => (
                        <Badge key={c} variant="outline" className="text-[11px]">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  ) : (
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
                  <Rationale text={t.rationale} />
                </ReviewRow>
              );
            })}
          </Section>

          <Section
            title="Cláusulas propostas"
            count={plan.clauses.length}
            icon={<Layers className="h-4 w-4" />}
            hint="Vão para o acervo aguardando aprovação. É a redação de vocês que passa a entrar no lugar do espaço reutilizável do modelo."
          >
            {plan.clauses.map((c) => {
              const key = clauseKey(c);
              return (
                <ReviewRow
                  key={key}
                  checked={decisions?.clauses[key] ?? false}
                  disabled={submitting || run.status !== "awaiting_review"}
                  onChange={(v) =>
                    setDecisions((prev) =>
                      prev ? { ...prev, clauses: { ...prev.clauses, [key]: v } } : prev
                    )
                  }
                  title={c.title}
                  subtitle={`${slotLabel(c.slot)} · ${c.value}${
                    c.provider ? ` · ${c.provider}` : " · vale para qualquer fornecedor"
                  } · ${filenameOf(c.sourceItemId)}`}
                >
                  <p className="rounded bg-muted/40 px-2 py-1.5 text-[11px] leading-snug">
                    {preview(c.content, 320)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[11px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <Rationale text={c.rationale} />
                </ReviewRow>
              );
            })}
          </Section>

          <Section
            title="Arquivos descartados"
            count={plan.discards.length}
            icon={<Trash2 className="h-4 w-4" />}
            hint="Desmarque para registrar que você não concorda com o descarte — o arquivo não vira nada nesta rodada, mas o relatório guarda a discordância."
          >
            {plan.discards.map((d) => (
              <ReviewRow
                key={d.itemId}
                checked={decisions?.discards[d.itemId] ?? true}
                disabled={submitting || run.status !== "awaiting_review"}
                onChange={(v) =>
                  setDecisions((prev) =>
                    prev ? { ...prev, discards: { ...prev.discards, [d.itemId]: v } } : prev
                  )
                }
                title={filenameOf(d.itemId)}
                subtitle={DISCARD_REASON_LABELS[d.reason] ?? d.reason}
              >
                <p className="text-[11px] text-muted-foreground">{d.detail}</p>
              </ReviewRow>
            ))}
          </Section>

          {run.status === "awaiting_review" && (
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
                onClick={() => void submit()}
              >
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Aplicar {counts.templates} modelo(s) e {counts.clauses} cláusula(s)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Blocos
// ────────────────────────────────────────────────────────────────────────────

function SuggestOnlyNotice() {
  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50/50 p-3 text-xs leading-snug dark:border-violet-900 dark:bg-violet-950/20">
      <p className="font-medium">Nada entra no ar sozinho.</p>
      <p className="mt-1 text-muted-foreground">
        Os modelos aprovados aqui nascem como <strong>rascunho</strong> e as cláusulas
        entram no acervo <strong>aguardando aprovação</strong>. Enquanto isso, nada do
        que já funciona hoje muda.
      </p>
      <ActivationOrder />
    </div>
  );
}

/**
 * A ordem NÃO é decorativa: o modelo com espaço de cláusula não carrega a
 * redação no corpo — quem a devolve na geração é o acervo, e só cláusula
 * aprovada conta. Ativar o modelo antes de aprovar a cláusula faria o contrato
 * sair com o texto padrão da plataforma no lugar do texto da imobiliária. A
 * ativação tem trava pra isso; o aviso existe pra ela nunca precisar aparecer.
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
  plan,
  filenameOf,
}: {
  plan: NonNullable<ReturnType<typeof parseLibraryPlan>>;
  filenameOf: (id: string | null) => string;
}) {
  if (plan.issues.length === 0) return null;
  return (
    <div className="space-y-2">
      {plan.issues.map((issue, i) => {
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

function ReviewRow({
  checked,
  disabled,
  onChange,
  title,
  subtitle,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border p-3">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{subtitle}</span>
        </span>
      </label>
      {children && <div className="mt-2 space-y-1.5 pl-6">{children}</div>}
    </li>
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
