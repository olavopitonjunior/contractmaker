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

function formatBRL(cents: number): string {
  const reais = cents / 100;
  return reais.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function MoneyInput({
  value,
  onChange,
  placeholder,
  className,
  id,
  min = 0,
}: MoneyInputProps) {
  const cents = React.useMemo(() => {
    if (value == null || Number.isNaN(value)) return 0;
    return Math.round(value * 100);
  }, [value]);

  const [display, setDisplay] = React.useState<string>(() => formatBRL(cents));

  React.useEffect(() => {
    setDisplay(formatBRL(cents));
  }, [cents]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "");
    const nextCents = digits === "" ? 0 : parseInt(digits, 10);
    const nextValue = nextCents / 100;
    setDisplay(formatBRL(nextCents));
    onChange(nextValue >= min ? nextValue : min);
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      placeholder={placeholder || "R$ 0,00"}
      className={className}
    />
  );
}
