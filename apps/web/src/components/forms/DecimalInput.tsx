"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { parsePercentBR } from "@/lib/format/money";

interface DecimalInputProps {
  value?: number | null;
  onChange: (value: number | undefined) => void;
  /** Sufixo visual (ex.: "%", "m²") — não entra no valor. */
  suffix?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  min?: number;
  max?: number;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  "aria-describedby"?: string;
}

/**
 * Campo decimal não-monetário (percentual, área em m²).
 *
 * Existe porque `<input type="number">` com `valueAsNumber` **rejeita a vírgula**
 * no teclado brasileiro: digitar "45,5" deixa o `value` vazio e o RHF grava
 * `NaN`, apagando o campo em silêncio. É a "formatação de decimais" que a
 * corretora reportou. Aqui o input é `type="text" inputMode="decimal"` e o
 * parsing sai do `parsePercentBR`, que trata ponto e vírgula como decimal e
 * nunca como separador de milhar (percentual não tem milhar).
 *
 * Para dinheiro use `MoneyInput` — lá o ponto PODE ser separador de milhar.
 */
export function DecimalInput({
  value,
  onChange,
  suffix,
  placeholder,
  className,
  id,
  min = 0,
  max,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
  "aria-describedby": ariaDescribedBy,
}: DecimalInputProps) {
  const [focused, setFocused] = React.useState(false);
  const format = (n: number | null | undefined): string =>
    n === null || n === undefined || !Number.isFinite(n)
      ? ""
      : String(n).replace(".", ",");
  const [raw, setRaw] = React.useState<string>(() => format(value));

  React.useEffect(() => {
    if (!focused) setRaw(format(value));
  }, [value, focused]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setRaw(next);
    // Campo esvaziado é ausência, não zero — senão apagar o texto gravaria 0 e
    // o default da org/schema nunca voltaria a valer.
    if (!next.trim()) {
      onChange(undefined);
      return;
    }
    let parsed = parsePercentBR(next);
    if (parsed < min) parsed = min;
    if (max !== undefined && parsed > max) parsed = max;
    onChange(parsed);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setRaw(format(raw.trim() ? parsePercentBR(raw) : undefined));
        }}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        aria-describedby={ariaDescribedBy}
        className={`${suffix ? "pr-10" : ""} ${className || ""}`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}
