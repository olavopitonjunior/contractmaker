"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

interface FontFamilyDropdownProps {
  editor: Editor;
}

const FONT_FAMILIES = [
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Calibri", value: "Calibri, Candara, Segoe, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
];

export function FontFamilyDropdown({ editor }: FontFamilyDropdownProps) {
  const currentFont = (editor.getAttributes("textStyle").fontFamily as string) || "";
  const currentLabel =
    FONT_FAMILIES.find((f) => f.value === currentFont)?.label || "Padrão";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 gap-1 min-w-[110px] justify-between text-xs"
          aria-label="Família da fonte"
          title="Família da fonte"
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem
          onClick={() => editor.chain().focus().unsetFontFamily().run()}
          className="text-xs"
        >
          Padrão
        </DropdownMenuItem>
        {FONT_FAMILIES.map((font) => (
          <DropdownMenuItem
            key={font.value}
            onClick={() => editor.chain().focus().setFontFamily(font.value).run()}
            className="text-xs"
            style={{ fontFamily: font.value }}
          >
            {font.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
