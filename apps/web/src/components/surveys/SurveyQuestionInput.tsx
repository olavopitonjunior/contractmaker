"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyQuestion } from "@/lib/surveys/types";

/**
 * Renderizador de UMA pergunta da pesquisa — compartilhado entre o preview do
 * builder e a página pública /s/[token]. Mobile-first: alvos de toque grandes,
 * NPS 0-10 em grade e CSAT em 5 estrelas.
 */

export type SurveyAnswerValue = number | string | string[] | undefined;

export function SurveyQuestionInput({
  question,
  value,
  onChange,
  disabled,
}: {
  question: SurveyQuestion;
  value: SurveyAnswerValue;
  onChange: (value: SurveyAnswerValue) => void;
  disabled?: boolean;
}) {
  switch (question.type) {
    case "nps":
      return (
        <div>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
            {Array.from({ length: 11 }, (_, score) => (
              <button
                key={score}
                type="button"
                disabled={disabled}
                onClick={() => onChange(score)}
                aria-label={`Nota ${score}`}
                className={cn(
                  "h-11 rounded-md border text-sm font-semibold transition-colors",
                  value === score
                    ? score <= 6
                      ? "border-red-500 bg-red-500 text-white"
                      : score <= 8
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-green-600 bg-green-600 text-white"
                    : "border-input bg-background hover:bg-muted"
                )}
              >
                {score}
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>Nada provável</span>
            <span>Muito provável</span>
          </div>
        </div>
      );

    case "csat":
      return (
        <div>
          <div className="flex justify-center gap-2 sm:justify-start">
            {Array.from({ length: 5 }, (_, i) => {
              const score = i + 1;
              const filled = typeof value === "number" && value >= score;
              return (
                <button
                  key={score}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(score)}
                  aria-label={`${score} de 5`}
                  className="rounded-md p-2 transition-transform hover:scale-110"
                >
                  <Star
                    className={cn(
                      "h-9 w-9",
                      filled
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/40"
                    )}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>Muito insatisfeito</span>
            <span>Muito satisfeito</span>
          </div>
        </div>
      );

    case "single":
      return (
        <div className="space-y-2">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                "w-full rounded-md border px-4 py-3 text-left text-sm transition-colors",
                value === option
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-input bg-background hover:bg-muted"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      );

    case "multi": {
      const selected = Array.isArray(value) ? value : [];
      const toggle = (option: string) =>
        onChange(
          selected.includes(option)
            ? selected.filter((item) => item !== option)
            : [...selected, option]
        );
      return (
        <div className="space-y-2">
          {question.options.map((option) => (
            <label
              key={option}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-sm transition-colors",
                selected.includes(option)
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-input bg-background hover:bg-muted"
              )}
            >
              <Checkbox
                checked={selected.includes(option)}
                onCheckedChange={() => toggle(option)}
                disabled={disabled}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }

    case "text":
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={4}
          maxLength={5000}
          placeholder="Escreva aqui…"
          className="text-base"
        />
      );
  }
}
