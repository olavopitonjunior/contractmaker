"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Gauge,
  ListChecks,
  ListPlus,
  MessageSquareText,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  surveyQuestionsSchema,
  type SurveyQuestion,
  type SurveyQuestionType,
} from "@/lib/surveys/types";
import {
  SurveyQuestionInput,
  type SurveyAnswerValue,
} from "./SurveyQuestionInput";

type Step = "info" | "perguntas" | "preview" | "revisao";
const STEPS: { key: Step; label: string }[] = [
  { key: "info", label: "1. Pesquisa" },
  { key: "perguntas", label: "2. Perguntas" },
  { key: "preview", label: "3. Preview" },
  { key: "revisao", label: "4. Criar" },
];

const TYPE_META: Record<
  SurveyQuestionType,
  { label: string; hint: string; icon: React.ComponentType<{ className?: string }> }
> = {
  nps: { label: "NPS (0-10)", hint: "Recomendação — alimenta o NPS do relatório", icon: Gauge },
  csat: { label: "CSAT (1-5)", hint: "Satisfação em estrelas — alimenta o CSAT", icon: Star },
  single: { label: "Seleção única", hint: "Uma opção entre várias", icon: ListChecks },
  multi: { label: "Seleção múltipla", hint: "Várias opções", icon: ListPlus },
  text: { label: "Texto aberto", hint: "Observações escritas — viram cards no relatório", icon: MessageSquareText },
};

let nextId = 1;
function newQuestion(type: SurveyQuestionType): SurveyQuestion {
  const id = `q_${Date.now().toString(36)}_${nextId++}`;
  const base = { id, required: true };
  switch (type) {
    case "nps":
      return { ...base, type, label: "Em uma escala de 0 a 10, o quanto você recomendaria nosso atendimento?" };
    case "csat":
      return { ...base, type, label: "Qual seu nível de satisfação com o processo?" };
    case "single":
      return { ...base, type, label: "", options: ["", ""] };
    case "multi":
      return { ...base, type, label: "", options: ["", ""], required: false };
    case "text":
      return { ...base, type, label: "Deixe suas observações", required: false };
  }
}

export interface SurveyBuilderInitial {
  fromVersionId?: string;
  name?: string;
  description?: string;
  questions?: SurveyQuestion[];
  thankYouMessage?: string;
}

export function SurveyBuilder({ initial }: { initial?: SurveyBuilderInitial }) {
  const router = useRouter();
  const isNewVersion = Boolean(initial?.fromVersionId);

  const [step, setStep] = useState<Step>("info");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [thankYou, setThankYou] = useState(initial?.thankYouMessage ?? "");
  const [questions, setQuestions] = useState<SurveyQuestion[]>(
    initial?.questions ?? [newQuestion("nps"), newQuestion("text")]
  );
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);

  const validation = useMemo(
    () => surveyQuestionsSchema.safeParse(questions),
    [questions]
  );
  const validationError = validation.success
    ? null
    : validation.error.issues[0]?.message ?? "Perguntas inválidas";

  const infoOk = name.trim().length > 0;
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  function updateQuestion(index: number, patch: Partial<SurveyQuestion>) {
    setQuestions((qs) =>
      qs.map((q, i) => (i === index ? ({ ...q, ...patch } as SurveyQuestion) : q))
    );
  }

  function moveQuestion(index: number, delta: -1 | 1) {
    setQuestions((qs) => {
      const target = index + delta;
      if (target < 0 || target >= qs.length) return qs;
      const copy = [...qs];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  async function submit() {
    if (!validation.success || !infoOk) return;
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        questions: validation.data,
        settings: thankYou.trim() ? { thankYouMessage: thankYou.trim() } : undefined,
      };
      const url = isNewVersion
        ? `/api/surveys/templates/${initial!.fromVersionId}/new-version`
        : "/api/surveys/templates";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao criar a pesquisa");
        return;
      }
      toast.success(
        isNewVersion
          ? `Versão v${data.template.version} criada — novo lote de relatório iniciado`
          : "Pesquisa criada"
      );
      router.push("/pesquisas");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => i <= stepIndex && setStep(s.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              step === s.key
                ? "bg-primary text-primary-foreground"
                : i < stepIndex
                  ? "border border-green-300 bg-green-100 text-green-900"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {i < stepIndex && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
            {s.label}
          </button>
        ))}
      </div>

      {isNewVersion && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Você está criando uma <strong>nova versão</strong>. A versão anterior é
          imutável e mantém o relatório dela; esta versão inicia um{" "}
          <strong>novo lote com relatório zerado</strong>.
        </div>
      )}

      {step === "info" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados da pesquisa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="survey-name">Nome *</Label>
              <Input
                id="survey-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Satisfação pós-assinatura — vendas"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="survey-desc">Descrição</Label>
              <Textarea
                id="survey-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Uso interno — quando e pra quem esta pesquisa é enviada"
                rows={2}
                maxLength={1000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="survey-thanks">Mensagem de agradecimento</Label>
              <Textarea
                id="survey-thanks"
                value={thankYou}
                onChange={(e) => setThankYou(e.target.value)}
                placeholder="Mostrada ao cliente após responder (opcional)"
                rows={2}
                maxLength={1000}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {step === "perguntas" && (
        <div className="space-y-3">
          {questions.map((q, index) => {
            const Icon = TYPE_META[q.type].icon;
            return (
              <Card key={q.id}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="gap-1">
                      <Icon className="h-3 w-3" />
                      {TYPE_META[q.type].label}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === 0}
                        onClick={() => moveQuestion(index, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === questions.length - 1}
                        onClick={() => moveQuestion(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() =>
                          setQuestions((qs) => qs.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <Input
                    value={q.label}
                    onChange={(e) => updateQuestion(index, { label: e.target.value })}
                    placeholder="Texto da pergunta"
                    maxLength={500}
                  />

                  {(q.type === "single" || q.type === "multi") && (
                    <div className="space-y-2">
                      {q.options.map((option, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <Input
                            value={option}
                            onChange={(e) => {
                              const options = [...q.options];
                              options[oi] = e.target.value;
                              updateQuestion(index, { options });
                            }}
                            placeholder={`Opção ${oi + 1}`}
                            maxLength={200}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-destructive"
                            disabled={q.options.length <= 2}
                            onClick={() =>
                              updateQuestion(index, {
                                options: q.options.filter((_, i) => i !== oi),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={q.options.length >= 12}
                        onClick={() =>
                          updateQuestion(index, { options: [...q.options, ""] })
                        }
                      >
                        <Plus className="mr-1 h-3 w-3" /> Adicionar opção
                      </Button>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      checked={q.required}
                      onCheckedChange={(checked) =>
                        updateQuestion(index, { required: checked })
                      }
                    />
                    Obrigatória
                  </label>
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardContent className="pt-4">
              <p className="mb-2 text-sm font-medium">Adicionar pergunta</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(TYPE_META) as SurveyQuestionType[]).map((type) => {
                  const Icon = TYPE_META[type].icon;
                  const disabled =
                    (type === "nps" && questions.some((q) => q.type === "nps")) ||
                    (type === "csat" && questions.some((q) => q.type === "csat")) ||
                    questions.length >= 15;
                  return (
                    <Button
                      key={type}
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      title={TYPE_META[type].hint}
                      onClick={() => setQuestions((qs) => [...qs, newQuestion(type)])}
                    >
                      <Icon className="mr-1 h-3 w-3" />
                      {TYPE_META[type].label}
                    </Button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Máx. 15 perguntas; 1 NPS e 1 CSAT por pesquisa.
              </p>
            </CardContent>
          </Card>

          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>
      )}

      {step === "preview" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Preview — como o destinatário vê (mobile)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-sm space-y-6 rounded-xl border bg-background p-4 shadow-xs">
              {questions.map((q, i) => (
                <div key={q.id} className="space-y-2">
                  <p className="text-sm font-medium">
                    {i + 1}. {q.label || <em className="text-muted-foreground">sem texto</em>}
                    {!q.required && (
                      <span className="ml-1 text-xs text-muted-foreground">(opcional)</span>
                    )}
                  </p>
                  <SurveyQuestionInput
                    question={q}
                    value={previewAnswers[q.id]}
                    onChange={(value) =>
                      setPreviewAnswers((prev) => ({ ...prev, [q.id]: value }))
                    }
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {step === "revisao" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revisão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Nome:</span>{" "}
              <strong>{name || "—"}</strong>
            </p>
            {description && (
              <p>
                <span className="text-muted-foreground">Descrição:</span> {description}
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Perguntas:</span>{" "}
              {questions.length} (
              {questions.filter((q) => q.type === "nps").length > 0 && "NPS, "}
              {questions.filter((q) => q.type === "csat").length > 0 && "CSAT, "}
              {questions.filter((q) => q.type === "text").length} de texto)
            </p>
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900">
              Após criar, as perguntas ficam <strong>imutáveis</strong> — este é um
              lote de relatório. Pra alterar, crie uma nova versão (novo lote,
              relatório zerado).
            </div>
            {validationError && (
              <p className="text-destructive">{validationError}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={stepIndex === 0}
          onClick={() => setStep(STEPS[stepIndex - 1].key)}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
        </Button>
        {step !== "revisao" ? (
          <Button
            disabled={step === "info" ? !infoOk : !validation.success}
            onClick={() => setStep(STEPS[stepIndex + 1].key)}
          >
            Avançar <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button disabled={submitting || !validation.success || !infoOk} onClick={submit}>
            {submitting
              ? "Criando…"
              : isNewVersion
                ? "Criar nova versão"
                : "Criar pesquisa"}
          </Button>
        )}
      </div>
    </div>
  );
}
