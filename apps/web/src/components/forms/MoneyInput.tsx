"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { parseMoneyBR } from "@/lib/format/money";

interface MoneyInputProps {
  value?: number;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  min?: number;
  /** Repassado ao Input interno — sem isto a borda de erro e o scroll-até-a-
   *  pendência ignoram os campos de dinheiro (valor total, sinal, renda). */
  "aria-invalid"?: boolean;
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
// Parsing delegado ao util compartilhado (lib/format/money) — fonte única de
// verdade, coberta por testes. Evita divergência com os parsers do servidor.
const parseInput = parseMoneyBR;

export function MoneyInput({
  value,
  onChange,
  placeholder = "Ex: 850.000,00",
  className,
  id,
  min = 0,
  "aria-invalid": ariaInvalid,
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
        aria-invalid={ariaInvalid}
        className={`pl-9 ${className || ""}`}
      />
    </div>
  );
}
