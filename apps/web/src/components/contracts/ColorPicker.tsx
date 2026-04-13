"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Type, Highlighter } from "lucide-react";

interface ColorSwatchesProps {
  editor: Editor;
  variant: "text" | "highlight";
}

const TEXT_COLORS: Array<{ label: string; value: string }> = [
  { label: "Padrão", value: "" },
  { label: "Preto", value: "#000000" },
  { label: "Cinza escuro", value: "#4b5563" },
  { label: "Cinza", value: "#9ca3af" },
  { label: "Vermelho", value: "#dc2626" },
  { label: "Laranja", value: "#ea580c" },
  { label: "Amarelo", value: "#ca8a04" },
  { label: "Verde", value: "#16a34a" },
  { label: "Azul", value: "#2563eb" },
  { label: "Roxo", value: "#9333ea" },
  { label: "Rosa", value: "#db2777" },
  { label: "Branco", value: "#ffffff" },
];

const HIGHLIGHT_COLORS: Array<{ label: string; value: string }> = [
  { label: "Sem cor", value: "" },
  { label: "Amarelo", value: "#fef08a" },
  { label: "Verde", value: "#bbf7d0" },
  { label: "Azul claro", value: "#bfdbfe" },
  { label: "Rosa", value: "#fbcfe8" },
  { label: "Laranja", value: "#fed7aa" },
  { label: "Cinza", value: "#e5e7eb" },
  { label: "Vermelho claro", value: "#fecaca" },
  { label: "Roxo claro", value: "#e9d5ff" },
];

function ColorSwatches({ editor, variant }: ColorSwatchesProps) {
  const colors = variant === "text" ? TEXT_COLORS : HIGHLIGHT_COLORS;

  function apply(value: string) {
    if (variant === "text") {
      if (!value) editor.chain().focus().unsetColor().run();
      else editor.chain().focus().setColor(value).run();
    } else {
      if (!value) editor.chain().focus().unsetHighlight().run();
      else editor.chain().focus().toggleHighlight({ color: value }).run();
    }
  }

  return (
    <div className="grid grid-cols-6 gap-1 p-1">
      {colors.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => apply(c.value)}
          className="h-6 w-6 rounded border border-border hover:ring-2 hover:ring-primary/40 transition"
          style={{
            backgroundColor: c.value || "transparent",
            backgroundImage: c.value
              ? undefined
              : "linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)",
          }}
          title={c.label}
          aria-label={c.label}
        />
      ))}
    </div>
  );
}

interface ColorPickerProps {
  editor: Editor;
  variant: "text" | "highlight";
}

export function ColorPicker({ editor, variant }: ColorPickerProps) {
  const Icon = variant === "text" ? Type : Highlighter;
  const currentColor =
    variant === "text"
      ? (editor.getAttributes("textStyle").color as string) || ""
      : (editor.getAttributes("highlight").color as string) || "";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 relative text-muted-foreground hover:text-foreground"
          aria-label={variant === "text" ? "Cor do texto" : "Cor de destaque"}
          title={variant === "text" ? "Cor do texto" : "Cor de destaque"}
        >
          <Icon className="h-4 w-4" />
          {currentColor && (
            <span
              className="absolute bottom-1 left-1 right-1 h-1 rounded-sm"
              style={{ backgroundColor: currentColor }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1" align="start">
        <ColorSwatches editor={editor} variant={variant} />
      </PopoverContent>
    </Popover>
  );
}
