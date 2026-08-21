"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface NativeSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: SelectOption[] | SelectGroup[];
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  /** Repassado ao `<select>`: acende a borda de erro e deixa o campo achável
   *  pelo scroll-até-a-pendência do RequiredFieldMarker. */
  "aria-invalid"?: boolean;
}

function isGrouped(
  options: SelectOption[] | SelectGroup[]
): options is SelectGroup[] {
  return options.length > 0 && "options" in (options[0] as SelectGroup);
}

export function NativeSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  id,
  disabled = false,
  "aria-invalid": ariaInvalid,
}: NativeSelectProps) {
  const grouped = isGrouped(options);
  return (
    <select
      id={id}
      value={value ?? ""}
      disabled={disabled}
      aria-invalid={ariaInvalid}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-hidden transition-[color,box-shadow]",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {grouped
        ? (options as SelectGroup[]).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ))
        : (options as SelectOption[]).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
    </select>
  );
}
