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
import { AVAILABLE_FONT_SIZES } from "@/lib/editor/FontSize";

interface FontSizeDropdownProps {
  editor: Editor;
}

export function FontSizeDropdown({ editor }: FontSizeDropdownProps) {
  const currentSize = (editor.getAttributes("textStyle").fontSize as string) || "";
  const display = currentSize ? currentSize.replace(/pt$/, "") : "—";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-14 px-1 gap-0.5 text-xs"
          aria-label="Tamanho da fonte"
          title="Tamanho da fonte (Ctrl+Shift+.)"
        >
          {display}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuItem
          onClick={() => editor.chain().focus().unsetFontSize().run()}
          className="text-xs"
        >
          Padrão
        </DropdownMenuItem>
        {AVAILABLE_FONT_SIZES.map((size) => (
          <DropdownMenuItem
            key={size}
            onClick={() => editor.chain().focus().setFontSize(`${size}pt`).run()}
            className="text-xs"
          >
            {size}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
