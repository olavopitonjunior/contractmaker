"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LineChart as LineHeightIcon } from "lucide-react";
import { AVAILABLE_LINE_HEIGHTS } from "@/lib/editor/LineHeight";

interface LineHeightDropdownProps {
  editor: Editor;
}

const LABELS: Record<string, string> = {
  "1": "Simples",
  "1.15": "1,15",
  "1.5": "1,5 (recomendado)",
  "2": "Duplo",
  "2.5": "2,5",
  "3": "Triplo",
};

export function LineHeightDropdown({ editor }: LineHeightDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          aria-label="Espaçamento entre linhas"
          title="Espaçamento entre linhas"
        >
          <LineHeightIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => editor.chain().focus().unsetLineHeight().run()}
          className="text-xs"
        >
          Padrão
        </DropdownMenuItem>
        {AVAILABLE_LINE_HEIGHTS.map((h) => {
          const key = String(h).replace(/\.0$/, "");
          return (
            <DropdownMenuItem
              key={h}
              onClick={() => editor.chain().focus().setLineHeight(h).run()}
              className="text-xs"
            >
              {LABELS[key] || `${String(h).replace(".", ",")}`}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
