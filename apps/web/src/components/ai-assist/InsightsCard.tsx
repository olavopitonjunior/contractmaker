"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, AlertTriangle, Lightbulb, Info } from "lucide-react";

type Severity = "info" | "alert" | "suggestion";

interface AIInsight {
  severity: Severity;
  title: string;
  detail?: string;
}

interface Props {
  context: "dashboard" | "contract" | "property" | "cashflow";
  contextId?: string;
  /** Title custom (default "Insights da IA"). */
  title?: string;
  /** Class extra no root. */
  className?: string;
}

const SEVERITY_ICON: Record<Severity, React.ComponentType<{ className?: string }>> = {
  info: Info,
  alert: AlertTriangle,
  suggestion: Lightbulb,
};

const SEVERITY_BG: Record<Severity, string> = {
  info: "bg-muted/40",
  alert: "bg-destructive/10 text-destructive",
  suggestion: "bg-primary/10 text-primary",
};

export function AIInsightsCard({
  context,
  contextId,
  title = "Insights da IA",
  className,
}: Props) {
  const [insights, setInsights] = useState<AIInsight[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Timeout client-side: se o servidor pendurar (ex.: Redis/Upstash inacessível
    // sem timeout, modelo lento), o skeleton resolveria pra sempre. Aborta em 12s
    // → cai no .catch → mostra "Insights indisponíveis" em vez de skeleton eterno.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    fetch("/api/ai/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, contextId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { insights: AIInsight[] };
        if (!cancelled) {
          setInsights(data.insights);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro");
          setLoading(false);
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [context, contextId]);

  // Não renderiza nada se sem insights (silenciosa se IA não tem nada útil).
  if (!loading && !error && (!insights || insights.length === 0)) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {loading && (
          <>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </>
        )}
        {error && (
          <p className="text-xs text-muted-foreground">
            Insights indisponíveis no momento.
          </p>
        )}
        {!loading && !error && insights?.map((ins, idx) => {
          const Icon = SEVERITY_ICON[ins.severity];
          return (
            <div
              key={idx}
              className={`flex items-start gap-2 rounded-md p-2 text-sm ${SEVERITY_BG[ins.severity]}`}
            >
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">{ins.title}</div>
                {ins.detail && (
                  <div className="mt-0.5 text-xs opacity-80">{ins.detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
