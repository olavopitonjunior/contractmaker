"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

interface MoneyInputProps {
  value?: number;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  min?: number;
}

/**
 * Formata numero para "850.000,00" (padrao brasileiro, sem prefixo R$).
 * O prefixo R$ e adicionado visualmente via span para nao poluir o valor digitado.
 */
function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte string digitada pelo usuario para numero.
 * Aceita:
 *   "850000"       -> 850000      (sem virgula = inteiro)
 *   "850000,50"    -> 850000.50   (virgula = decimal)
 *   "850.000"      -> 850000      (ponto como separador de milhar)
 *   "850.000,50"   -> 850000.50
 *   "R$ 850.000"   -> 850000      (remove prefixo)
 */
function parseInput(raw: string): number {
  if (!raw) return 0;
  // Remove tudo que nao e digito, virgula ou ponto
  let cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;

  // Se tem virgula, ela e o decimal. Pontos sao separadores de milhar.
  if (cleaned.includes(",")) {
    // Pega a ultima virgula como decimal
    const lastComma = cleaned.lastIndexOf(",");
    const integerPart = cleaned.slice(0, lastComma).replace(/[.,]/g, "");
    const decimalPart = cleaned.slice(lastComma + 1).replace(/[.,]/g, "");
    const normalized = `${integerPart}.${decimalPart}`;
    const n = parseFloat(normalized);
    return Number.isNaN(n) ? 0 : n;
  }

  // Sem virgula: pontos podem ser separador de milhar OU decimal (raro em pt-BR)
  // Convencao: se so tem um ponto com 1-2 digitos apos, tratar como decimal; caso contrario, milhar.
  const dotCount = (cleaned.match(/\./g) || []).length;
  if (dotCount === 1) {
    const afterDot = cleaned.split(".")[1];
    if (afterDot && afterDot.length <= 2) {
      // "100.5" = 100.5
      const n = parseFloat(cleaned);
      return Number.isNaN(n) ? 0 : n;
    }
  }
  // Multiplos pontos ou ponto com 3+ digitos: sao milhares, remover
  const n = parseFloat(cleaned.replace(/\./g, ""));
  return Number.isNaN(n) ? 0 : n;
}

export function MoneyInput({
  value,
  onChange,
  placeholder = "Ex: 850.000,00",
  className,
  id,
  min = 0,
}: MoneyInputProps) {
  const [focused, setFocused] = React.useState(false);
  const [rawInput, setRawInput] = React.useState<string>(() =>
    value ? formatNumber(value) : ""
  );

  // Quando o valor externo muda E o input nao esta focado, reformate
  React.useEffect(() => {
    if (!focused) {
      setRawInput(value ? formatNumber(value) : "");
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setRawInput(raw);
    const parsed = parseInput(raw);
    onChange(parsed >= min ? parsed : min);
  };

  const handleBlur = () => {
    setFocused(false);
    // Reformata o texto ao sair do campo
    const parsed = parseInput(rawInput);
    setRawInput(parsed > 0 ? formatNumber(parsed) : "");
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
        R$
      </span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={rawInput}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={`pl-9 ${className || ""}`}
      />
    </div>
  );
}
