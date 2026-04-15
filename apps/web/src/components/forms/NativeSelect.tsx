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
}: NativeSelectProps) {
  const grouped = isGrouped(options);
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow]",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
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
