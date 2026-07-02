"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Stethoscope, HelpCircle, Loader2 } from "lucide-react";

interface Finding {
  recordId?: string;
  field?: string;
  severity?: string;
  message?: string;
  suggestion?: string;
}
interface Diagnosis {
  linha?: string;
  campo?: string;
  classe?: "dado" | "leiaute";
  explicacao?: string;
  correcao?: string;
  layoutSugestao?: { fieldKey?: string; motivo?: string };
}

async function callAi(body: Record<string, unknown>) {
  const res = await fetch("/api/dimob/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Falha na IA");
  // Devolve o envelope completo (result + parseError + truncated) para o caller
  // distinguir "falha de parse da IA" de "nenhum resultado".
  return j as { result?: unknown; parseError?: boolean; truncated?: boolean };
}

const AI_PARSE_ERROR_MSG = "A IA não retornou um resultado válido. Tente novamente.";

export function DimobAssistant({
  year,
  records,
  onFindingClick,
}: {
  year: number;
  records: { recordId: string; title: string }[];
  onFindingClick?: (recordId: string, field?: string) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  const [pgdError, setPgdError] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);

  const [explainId, setExplainId] = useState(records[0]?.recordId ?? "");
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  async function runReview() {
    setReviewing(true);
    setFindings(null);
    try {
      const j = await callAi({ kind: "review", year });
      if (j.parseError) {
        toast.error(AI_PARSE_ERROR_MSG);
        return;
      }
      const r = j.result as { findings?: Finding[] } | null;
      setFindings(Array.isArray(r?.findings) ? r!.findings! : []);
      if (j.truncated) toast.warning("Muitas operações — a IA revisou as primeiras 60.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setReviewing(false);
    }
  }

  async function runDiagnose() {
    if (!pgdError.trim()) return;
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const j = await callAi({ kind: "diagnose", year, pgdError });
      if (j.parseError) {
        toast.error(AI_PARSE_ERROR_MSG);
        return;
      }
      setDiagnosis((j.result ?? null) as Diagnosis);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setDiagnosing(false);
    }
  }

  async function runExplain() {
    setExplaining(true);
    setExplanation(null);
    try {
      const j = await callAi({ kind: "explain", year, recordId: explainId });
      if (j.parseError) {
        toast.error(AI_PARSE_ERROR_MSG);
        return;
      }
      const r = j.result as { explicacao?: string } | null;
      setExplanation(typeof r?.explicacao === "string" ? r.explicacao : "Sem explicação.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-violet-500" />
          Assistente de IA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Revisar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Revisar suspeitas</p>
            <Button size="sm" variant="outline" onClick={runReview} disabled={reviewing}>
              {reviewing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
              Revisar com IA
            </Button>
          </div>
          {findings && findings.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma suspeita encontrada pela IA. ✅</p>
          )}
          {findings && findings.length > 0 && (
            <div className="space-y-1.5">
              {findings.map((f, i) => {
                const canJump = Boolean(onFindingClick && f.recordId);
                return (
                  <div
                    key={i}
                    className={`rounded-md border p-2 text-sm ${canJump ? "cursor-pointer transition-colors hover:bg-muted/60" : ""}`}
                    role={canJump ? "button" : undefined}
                    tabIndex={canJump ? 0 : undefined}
                    onClick={canJump ? () => onFindingClick!(f.recordId!, f.field) : undefined}
                    onKeyDown={
                      canJump
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") onFindingClick!(f.recordId!, f.field);
                          }
                        : undefined
                    }
                    title={canJump ? "Ir para o registro" : undefined}
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary">{f.severity ?? "?"}</Badge>
                      <span className="font-medium">{f.field ?? f.recordId}</span>
                      {canJump && <span className="ml-auto text-xs text-primary">ir para o registro →</span>}
                    </div>
                    <p>{f.message}</p>
                    {f.suggestion && (
                      <p className="text-xs text-muted-foreground">Sugestão: {f.suggestion}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Diagnosticar erro do PGD */}
        <div className="space-y-2 border-t pt-4">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Stethoscope className="h-4 w-4" />
            Diagnosticar erro do programa da Receita (PGD)
          </p>
          <Textarea
            value={pgdError}
            onChange={(e) => setPgdError(e.target.value)}
            placeholder="Cole aqui a mensagem de erro que o PGD DIMOB mostrou ao importar o arquivo…"
            rows={3}
            className="text-sm"
          />
          <Button size="sm" variant="outline" onClick={runDiagnose} disabled={diagnosing || !pgdError.trim()}>
            {diagnosing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Stethoscope className="mr-1 h-4 w-4" />}
            Diagnosticar
          </Button>
          {diagnosis && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex items-center gap-1.5">
                <Badge variant={diagnosis.classe === "leiaute" ? "destructive" : "secondary"}>
                  {diagnosis.classe === "leiaute" ? "leiaute (técnico)" : "dado (você corrige)"}
                </Badge>
                {diagnosis.campo && <span className="font-medium">{diagnosis.campo}</span>}
                {diagnosis.linha && <span className="text-muted-foreground">· {diagnosis.linha}</span>}
              </div>
              {diagnosis.explicacao && <p>{diagnosis.explicacao}</p>}
              {diagnosis.correcao && (
                <p className="text-muted-foreground"><strong>Correção:</strong> {diagnosis.correcao}</p>
              )}
              {diagnosis.classe === "leiaute" && diagnosis.layoutSugestao && (
                <p className="text-xs text-muted-foreground">
                  Sugestão de leiaute ({diagnosis.layoutSugestao.fieldKey}): {diagnosis.layoutSugestao.motivo}
                  <br />
                  <em>Ajuste técnico no arquivo layout.ts — reporte ao time de dev; a IA não altera o código.</em>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Explicar registro */}
        {records.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <HelpCircle className="h-4 w-4" />
              Explicar um registro
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={explainId}
                onChange={(e) => setExplainId(e.target.value)}
                className="h-9 max-w-[60%] rounded-md border bg-background px-2 text-sm"
              >
                {records.map((r) => (
                  <option key={r.recordId} value={r.recordId}>
                    {r.title}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={runExplain} disabled={explaining}>
                {explaining ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <HelpCircle className="mr-1 h-4 w-4" />}
                Explicar
              </Button>
            </div>
            {explanation && (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">{explanation}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
