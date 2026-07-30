"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cpfRule,
  cnpjRule,
  telefoneRule,
  maskCPF,
  maskCNPJ,
  maskTelefone,
} from "@/lib/forms/field-formats";
import type { CategoryFieldDef } from "@/lib/forms/participant-category";

/**
 * Step ÚNICO e genérico do link de TERCEIRO: renderiza as field defs que a
 * imobiliária cadastrou na categoria (`FormParticipantCategory.fields`).
 *
 * Não entra na numeração de `STEP_LABELS` nem nos wizards de venda/locação de
 * propósito — os 5 papéis nativos têm steps com regras próprias (PF/PJ,
 * cônjuge, OCR, certidões) e nada disso se aplica a um campo declarado por
 * configuração. Aqui só existem os 7 tipos de `CATEGORY_FIELD_TYPES`.
 *
 * As máscaras e as regras de formato são as MESMAS do resto do formulário
 * (`lib/forms/field-formats.ts`): CPF/CNPJ/telefone mascaram enquanto digita e
 * só reclamam quando preenchidos com formato inválido — campo vazio nunca
 * bloqueia por formato (isso é papel do `required`).
 */

export interface TerceiroStepProps {
  fields: readonly CategoryFieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
  /** Chaves com erro de obrigatoriedade vindas do 422 do servidor. */
  missingKeys?: readonly string[];
  disabled?: boolean;
}

/** Máscara por tipo — tipos sem máscara passam o valor cru. */
export function maskByType(type: CategoryFieldDef["type"], raw: string): string {
  switch (type) {
    case "cpf":
      return maskCPF(raw);
    case "cnpj":
      return maskCNPJ(raw);
    case "phone":
      return maskTelefone(raw);
    default:
      return raw;
  }
}

/** Erro de FORMATO do valor (vazio sempre passa). `null` = ok. */
export function formatErrorForType(
  type: CategoryFieldDef["type"],
  value: unknown,
): string | null {
  const raw = value == null ? "" : String(value);
  if (raw.trim() === "") return null;
  switch (type) {
    case "cpf": {
      const r = cpfRule(raw);
      return r === true ? null : r;
    }
    case "cnpj": {
      const r = cnpjRule(raw);
      return r === true ? null : r;
    }
    case "phone": {
      const r = telefoneRule(raw);
      return r === true ? null : r;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim())
        ? null
        : "E-mail inválido";
    default:
      return null;
  }
}

function inputType(type: CategoryFieldDef["type"]): string {
  if (type === "date") return "date";
  if (type === "email") return "email";
  return "text";
}

export function TerceiroStep({
  fields,
  values,
  onChange,
  missingKeys = [],
  disabled,
}: TerceiroStepProps) {
  const missing = new Set(missingKeys);

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta categoria ainda não tem campos configurados. Fale com a
        imobiliária.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const raw = values[field.key];
        const value = raw == null ? "" : String(raw);
        const formatError = formatErrorForType(field.type, value);
        const isMissing = missing.has(field.key) && value.trim() === "";
        const error = isMissing ? "Campo obrigatório" : formatError;
        const isWide = field.type === "textarea";
        return (
          <div
            key={field.key}
            className={isWide ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}
          >
            <Label htmlFor={`terceiro-${field.key}`}>
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </Label>
            {isWide ? (
              <Textarea
                id={`terceiro-${field.key}`}
                value={value}
                rows={4}
                disabled={disabled}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            ) : (
              <Input
                id={`terceiro-${field.key}`}
                type={inputType(field.type)}
                value={value}
                disabled={disabled}
                inputMode={
                  field.type === "cpf" ||
                  field.type === "cnpj" ||
                  field.type === "phone"
                    ? "numeric"
                    : undefined
                }
                onChange={(e) =>
                  onChange(field.key, maskByType(field.type, e.target.value))
                }
              />
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
