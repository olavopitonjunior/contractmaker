"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { SurveyQuestion } from "@/lib/surveys/types";
import {
  SurveyQuestionInput,
  type SurveyAnswerValue,
} from "./SurveyQuestionInput";

/**
 * Página pública de resposta — mobile-first, UMA pergunta por tela com barra
 * de progresso. NPS/CSAT/seleção única avançam sozinhos ao tocar (tap-once);
 * múltipla e texto têm botão Avançar. Estado local, um único POST no final.
 */
export function SurveyPublicClient({
  token,
  surveyName,
  brandName,
  brandLogoUrl,
  recipientName,
  questions,
  thankYouMessage,
}: {
  token: string;
  surveyName: string;
  brandName: string | null;
  brandLogoUrl: string | null;
  recipientName: string | null;
  questions: SurveyQuestion[];
  thankYouMessage: string;
}) {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const progress = (index / questions.length) * 100;

  const currentValue = question ? answers[question.id] : undefined;
  const currentAnswered = useMemo(() => {
    if (!question) return false;
    const v = answers[question.id];
    if (v === undefined) return false;
    if (question.type === "text") return typeof v === "string" && v.trim().length > 0;
    if (question.type === "multi") return Array.isArray(v) && v.length > 0;
    return true;
  }, [question, answers]);

  function buildPayload() {
    return questions
      .map((q) => {
        const value = answers[q.id];
        if (value === undefined) return null;
        if (q.type === "text" && typeof value === "string" && !value.trim()) return null;
        if (q.type === "multi" && Array.isArray(value) && value.length === 0) return null;
        return { questionId: q.id, type: q.type, value };
      })
      .filter(Boolean);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/surveys/${token}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: buildPayload() }),
      });
      if (res.ok || res.status === 409) {
        setDone(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível enviar. Tente novamente.");
    } catch {
      setError("Falha de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function advance() {
    if (isLast) void submit();
    else setIndex((i) => i + 1);
  }

  function handleChange(value: SurveyAnswerValue) {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    // Tap-once avança sozinho (com um respiro pro usuário ver a seleção).
    if (
      !isLast &&
      (question.type === "nps" || question.type === "csat" || question.type === "single")
    ) {
      setTimeout(() => setIndex((i) => (i === index ? i + 1 : i)), 250);
    }
  }

  const header = (
    <header className="flex items-center gap-3 border-b bg-background px-4 py-3">
      {brandLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brandLogoUrl} alt={brandName ?? ""} className="h-8 w-auto" />
      ) : (
        <span className="text-sm font-semibold">{brandName ?? "Pesquisa"}</span>
      )}
    </header>
  );

  if (done) {
    return (
      <main className="flex min-h-screen flex-col bg-muted/30">
        {header}
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-600" />
            <h1 className="text-xl font-semibold">Obrigado!</h1>
            <p className="mt-2 text-sm text-muted-foreground">{thankYouMessage}</p>
          </div>
        </div>
      </main>
    );
  }

  if (!started) {
    return (
      <main className="flex min-h-screen flex-col bg-muted/30">
        {header}
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
            <h1 className="text-xl font-semibold">{surveyName}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {recipientName ? `Olá, ${recipientName}! ` : ""}São{" "}
              {questions.length} pergunta{questions.length === 1 ? "" : "s"} —
              leva menos de 2 minutos.
            </p>
            <Button className="mt-6 h-11 w-full text-base" onClick={() => setStarted(true)}>
              Começar
            </Button>
            {/* Opt-out também pra quem chegou por WhatsApp/link manual (o
                rodapé de e-mail não cobre esses canais). GET marca o invite
                como optout e volta pra esta página com a confirmação. */}
            <a
              href={`/api/public/surveys/${token}/optout`}
              className="mt-4 inline-block text-xs text-muted-foreground underline hover:text-foreground"
            >
              Não quero receber pesquisas
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-muted/30">
      {header}
      <Progress value={progress} className="h-1 rounded-none" />
      <div className="flex flex-1 items-start justify-center p-4 pt-10 sm:items-center sm:pt-4">
        <div className="w-full max-w-md space-y-6">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Pergunta {index + 1} de {questions.length}
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-snug">
              {question.label}
              {!question.required && (
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  (opcional)
                </span>
              )}
            </h2>
          </div>

          <SurveyQuestionInput
            question={question}
            value={currentValue}
            onChange={handleChange}
            disabled={submitting}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              disabled={index === 0 || submitting}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
            <Button
              className="h-11 min-w-32 text-base"
              disabled={submitting || (question.required && !currentAnswered)}
              onClick={advance}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isLast ? (
                "Enviar respostas"
              ) : question.required || currentAnswered ? (
                "Avançar"
              ) : (
                "Pular"
              )}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
