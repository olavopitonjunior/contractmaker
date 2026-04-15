"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Type, Check } from "lucide-react";

export interface DocumentFontPreset {
  id: string;
  label: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: number;
}

export const DOCUMENT_FONT_PRESETS: DocumentFontPreset[] = [
  {
    id: "formal-serif",
    label: "Formal — Tinos",
    fontFamily: 'var(--font-tinos), "Times New Roman", Georgia, serif',
    fontSize: "12pt",
    lineHeight: 1.65,
  },
  {
    id: "classic-serif",
    label: "Clássico — Georgia",
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: "12pt",
    lineHeight: 1.7,
  },
  {
    id: "editorial",
    label: "Editorial — Merriweather",
    fontFamily: 'var(--font-merriweather), Georgia, "Times New Roman", serif',
    fontSize: "11.5pt",
    lineHeight: 1.8,
  },
  {
    id: "modern-sans",
    label: "Moderno — Inter",
    fontFamily: 'var(--font-inter), "Segoe UI", system-ui, sans-serif',
    fontSize: "11pt",
    lineHeight: 1.6,
  },
  {
    id: "clean-sans",
    label: "Limpo — Arial",
    fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
    fontSize: "11pt",
    lineHeight: 1.55,
  },
  {
    id: "mono",
    label: "Monoespaçada — Courier",
    fontFamily: '"Courier New", "Courier Prime", monospace',
    fontSize: "11pt",
    lineHeight: 1.55,
  },
];

export function getPresetById(id: string): DocumentFontPreset {
  return DOCUMENT_FONT_PRESETS.find((p) => p.id === id) ?? DOCUMENT_FONT_PRESETS[0];
}

interface DocumentFontControlProps {
  presetId: string;
  onChange: (presetId: string) => void;
}

export function DocumentFontControl({ presetId, onChange }: DocumentFontControlProps) {
  const current = getPresetById(presetId);
  return (
    <TooltipProvider delayDuration={300}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                aria-label="Estilo de fonte do documento"
              >
                <Type className="h-3.5 w-3.5" />
                <span className="hidden md:inline max-w-[140px] truncate">
                  {current.label}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">Estilo de fonte do documento</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Estilo do documento inteiro
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {DOCUMENT_FONT_PRESETS.map((preset) => {
            const isActive = preset.id === presetId;
            return (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => onChange(preset.id)}
                className="flex items-start gap-2 py-2"
              >
                <div className="mt-0.5 w-3 shrink-0">
                  {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ fontFamily: preset.fontFamily }}
                  >
                    {preset.label}
                  </p>
                  <p
                    className="text-xs text-muted-foreground truncate"
                    style={{ fontFamily: preset.fontFamily }}
                  >
                    Aa Bb Cc — {preset.fontSize}, linha {preset.lineHeight}
                  </p>
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
