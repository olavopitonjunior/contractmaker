"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Gauge,
  Loader2,
  MessageSquareText,
  Percent,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiCard, BarRow, LineChart } from "@/components/admin/charts";
import { cn } from "@/lib/utils";
import type { SurveyReport } from "@/lib/surveys/report";
import { SUMMARY_MIN_TEXT_RESPONSES as MIN_TEXT_RESPONSES } from "@/lib/surveys/types";

interface FamilyOption {
  familyId: string;
  name: string;
  versions: Array<{
    id: string;
    version: number;
    isLatest: boolean;
    status: string;
    responseCount: number;
    createdAt: string;
  }>;
}

const ROLE_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  locador: "Locador",
  locatario: "Locatário",
  corretor: "Corretor",
};


/** Render leve do markdown do resumo (bold + bullets — sem lib). */
function SummaryText({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const content = trimmed.replace(/^[-*]\s+/, "");
        const parts = content.split(/\*\*(.+?)\*\*/g);
        const rendered = parts.map((part, j) =>
          j % 2 === 1 ? <strong key={j}>{part}</strong> : part
        );
        return trimmed.startsWith("-") || trimmed.startsWith("*") ? (
          <p key={i} className="pl-4">
            • {rendered}
          </p>
        ) : (
          <p key={i}>{rendered}</p>
        );
      })}
    </div>
  );
}

function AiSummaryCard({
  report,
  onGenerated,
}: {
  report: SurveyReport;
  onGenerated: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [fresh, setFresh] = useState<SurveyReport["aiSummary"]>(null);

  const summary = fresh ?? report.aiSummary;
  const canGenerate = report.textResponseCount >= MIN_TEXT_RESPONSES;
  const hasNew =
    summary !== null && report.textResponseCount > summary.responseCount;

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/surveys/reports/${report.template.id}/summary`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao gerar o resumo");
        return;
      }
      setFresh(data.summary);
      if (data.cached) toast.info("Sem respostas novas — resumo atual mantido");
      else {
        toast.success("Resumo gerado");
        onGenerated();
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4" />
            Resumo IA das observações
          </CardTitle>
          <Button
            size="sm"
            variant={summary ? "outline" : "default"}
            disabled={generating || !canGenerate}
            title={
              canGenerate
                ? undefined
                : `Disponível a partir de ${MIN_TEXT_RESPONSES} respostas de texto`
            }
            onClick={generate}
          >
            {generating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            {summary ? (hasNew ? "Atualizar resumo" : "Regerar") : "Gerar resumo"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {summary ? (
          <>
            <SummaryText text={summary.text} />
            <p className="mt-3 text-xs text-muted-foreground">
              Gerado em{" "}
              {new Date(summary.generatedAt).toLocaleDateString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}{" "}
              · {summary.responseCount} resposta(s) de texto · Haiku
              {hasNew &&
                ` · ${report.textResponseCount - summary.responseCount} nova(s) desde então`}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {canGenerate
              ? "Gere um resumo dos pontos fortes, atenções e ações sugeridas a partir das observações escritas deste lote."
              : `O resumo fica disponível a partir de ${MIN_TEXT_RESPONSES} respostas de texto (este lote tem ${report.textResponseCount}).`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SurveyReportClient({
  families,
  selectedFamilyId,
  selectedLoteId,
  report,
}: {
  families: FamilyOption[];
  selectedFamilyId: string | null;
  selectedLoteId: string | null;
  report: SurveyReport | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const family = families.find((f) => f.familyId === selectedFamilyId) ?? null;

  function navigate(familyId: string, loteId?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("family", familyId);
    if (loteId) params.set("lote", loteId);
    else params.delete("lote");
    router.replace(`/pesquisas/relatorios?${params.toString()}`);
  }

  if (families.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma pesquisa criada ainda.{" "}
          <Link href="/pesquisas/nova" className="underline">
            Criar a primeira
          </Link>
          .
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Seletor de lote — família + pills de versão. Lotes nunca se somam. */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedFamilyId ?? undefined}
          onValueChange={(v) => navigate(v)}
        >
          <SelectTrigger className="w-72">
            {/* children explícito: SelectValue sozinho rende vazio no SSR
                (registro de items do Radix só existe no client). */}
            <SelectValue placeholder="Escolha a pesquisa">
              {family?.name ?? "Escolha a pesquisa"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {families.map((f) => (
              <SelectItem key={f.familyId} value={f.familyId}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-1.5">
          {family?.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => navigate(family.familyId, v.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                v.id === selectedLoteId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-muted"
              )}
            >
              v{v.version}
              {v.isLatest ? " · atual" : ""} · {v.responseCount} resp.
            </button>
          ))}
        </div>
      </div>

      {!report ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Selecione um lote pra ver o relatório.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="NPS do lote"
              value={report.nps.score ?? "—"}
              sub={
                report.nps.score !== null
                  ? `${report.nps.promoters} promotores · ${report.nps.passives} neutros · ${report.nps.detractors} detratores`
                  : "sem pergunta NPS respondida"
              }
              icon={<Gauge className="h-4 w-4" />}
            />
            <KpiCard
              label="CSAT médio"
              value={report.csat.average !== null ? `${report.csat.average}/5` : "—"}
              icon={<Star className="h-4 w-4" />}
            />
            <KpiCard
              label="Taxa de resposta"
              value={
                report.totals.responseRate !== null
                  ? `${report.totals.responseRate}%`
                  : "—"
              }
              sub={`${report.totals.responses} de ${report.totals.invites} envios${
                report.totals.optouts > 0 ? ` · ${report.totals.optouts} opt-out` : ""
              }`}
              icon={<Percent className="h-4 w-4" />}
            />
            <KpiCard
              label="Respostas"
              value={report.totals.responses}
              sub={`lote v${report.template.version}`}
              icon={<Users className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Distribuição NPS 0-10 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Distribuição NPS (0–10)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {Object.keys(report.nps.distribution).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem respostas NPS.</p>
                ) : (
                  Array.from({ length: 11 }, (_, score) => 10 - score).map((score) => {
                    const count = report.nps.distribution[score] ?? 0;
                    const max = Math.max(...Object.values(report.nps.distribution), 1);
                    return (
                      <BarRow
                        key={score}
                        label={String(score)}
                        value={count}
                        max={max}
                        color={
                          score >= 9 ? "#16a34a" : score >= 7 ? "#f59e0b" : "#dc2626"
                        }
                      />
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* Distribuição CSAT 1-5 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Distribuição CSAT (1–5 ★)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {Object.keys(report.csat.distribution).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem respostas CSAT.</p>
                ) : (
                  [5, 4, 3, 2, 1].map((score) => {
                    const count = report.csat.distribution[score] ?? 0;
                    const max = Math.max(...Object.values(report.csat.distribution), 1);
                    return (
                      <BarRow
                        key={score}
                        label={`${score} ★`}
                        value={count}
                        max={max}
                        color={score >= 4 ? "#16a34a" : score === 3 ? "#f59e0b" : "#dc2626"}
                      />
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Perguntas de seleção */}
          {report.choices.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {report.choices.map((choice) => {
                const max = Math.max(...Object.values(choice.counts), 1);
                return (
                  <Card key={choice.questionId}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">
                        {choice.label}
                        {choice.multi && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            (múltipla)
                          </span>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      {Object.entries(choice.counts).map(([option, count]) => (
                        <BarRow key={option} label={option} value={count} max={max} />
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Respostas por semana */}
          {report.weekly.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Respostas por semana</CardTitle>
              </CardHeader>
              <CardContent>
                <LineChart
                  data={report.weekly.map((w) => ({
                    date: w.week,
                    value: w.count,
                  }))}
                />
              </CardContent>
            </Card>
          )}

          {/* Resumo IA das observações escritas (Haiku, cache por lote) */}
          <AiSummaryCard report={report} onGenerated={() => router.refresh()} />

          {/* Cards das observações escritas */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquareText className="h-4 w-4" />
                Observações escritas ({report.comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.comments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma observação escrita neste lote.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {report.comments.map((comment) => (
                    <div key={comment.id} className="rounded-md border p-3">
                      <p className="text-sm leading-relaxed">“{comment.text}”</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          {ROLE_LABEL[comment.role] ?? comment.role}
                        </Badge>
                        {comment.respondentName && <span>{comment.respondentName}</span>}
                        {comment.npsScore !== null && (
                          <span
                            className={
                              comment.npsScore <= 6
                                ? "font-medium text-red-600"
                                : comment.npsScore >= 9
                                  ? "font-medium text-green-600"
                                  : "font-medium text-amber-600"
                            }
                          >
                            NPS {comment.npsScore}
                          </span>
                        )}
                        {comment.csatScore !== null && (
                          <span className="font-medium">★ {comment.csatScore}/5</span>
                        )}
                        {comment.dealId && (
                          <Link
                            href={
                              comment.dealKind === "locacao"
                                ? `/locacao/deals/${comment.dealId}`
                                : `/deals/${comment.dealId}`
                            }
                            className="underline hover:text-foreground"
                          >
                            {comment.dealTitle ?? "ver negócio"}
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
