"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, BarChart3, GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SurveyAutomationDialog } from "./SurveyAutomationDialog";

export interface SurveyListRow {
  id: string;
  familyId: string;
  version: number;
  name: string;
  description: string | null;
  status: string;
  questionCount: number;
  versionCount: number;
  inviteCount: number;
  responseCount: number;
  createdAt: string;
}

export function SurveysListClient({ rows }: { rows: SurveyListRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function archive(row: SurveyListRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/surveys/templates/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao arquivar");
        return;
      }
      toast.success("Pesquisa arquivada — automações param de disparar esta família");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Pesquisas são <strong>imutáveis</strong>: cada versão é um lote com
          relatório próprio. Alterar perguntas = nova versão (relatório zerado).
        </p>
        <Button asChild>
          <Link href="/pesquisas/nova">
            <Plus className="mr-1 h-4 w-4" /> Nova pesquisa
          </Link>
        </Button>
      </div>

      {rows.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma pesquisa ainda. Crie a primeira — ela pode ser enviada
            manualmente do negócio ou disparada automaticamente por etapa do
            pipeline.
          </CardContent>
        </Card>
      )}

      {rows.map((row) => (
        <Card key={row.id} className={row.status === "archived" ? "opacity-60" : undefined}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.name}</span>
                <Badge variant="outline">v{row.version}</Badge>
                {row.status === "archived" && <Badge variant="secondary">Arquivada</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.questionCount} pergunta{row.questionCount === 1 ? "" : "s"} ·{" "}
                {row.versionCount} versão{row.versionCount === 1 ? "" : "ões"} ·{" "}
                {row.inviteCount} envio{row.inviteCount === 1 ? "" : "s"} ·{" "}
                {row.responseCount} resposta{row.responseCount === 1 ? "" : "s"} neste lote
              </p>
              {row.description && (
                <p className="mt-0.5 max-w-xl truncate text-xs text-muted-foreground">
                  {row.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SurveyAutomationDialog familyId={row.familyId} surveyName={row.name} />
              <Button variant="outline" size="sm" asChild>
                <Link href={`/pesquisas/relatorios?family=${row.familyId}&lote=${row.id}`}>
                  <BarChart3 className="mr-1 h-3.5 w-3.5" /> Relatório
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/pesquisas/nova?fromVersion=${row.id}`}>
                  <GitBranch className="mr-1 h-3.5 w-3.5" /> Nova versão
                </Link>
              </Button>
              {row.status !== "archived" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => archive(row)}
                >
                  <Archive className="mr-1 h-3.5 w-3.5" /> Arquivar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
