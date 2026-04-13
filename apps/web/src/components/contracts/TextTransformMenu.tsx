"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CaseSensitive } from "lucide-react";
import type { TextCase } from "@/lib/editor/TextTransform";

interface TextTransformMenuProps {
  editor: Editor;
}

const OPTIONS: Array<{ mode: TextCase; label: string; hint: string }> = [
  { mode: "upper", label: "MAIÚSCULAS", hint: "TODO O TEXTO EM CAIXA ALTA" },
  { mode: "lower", label: "minúsculas", hint: "todo o texto em caixa baixa" },
  { mode: "title", label: "Título", hint: "Primeira Letra De Cada Palavra" },
  { mode: "sentence", label: "Frase", hint: "Só a primeira letra." },
];

export function TextTransformMenu({ editor }: TextTransformMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          aria-label="Transformar caixa"
          title="Transformar caixa do texto"
        >
          <CaseSensitive className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.mode}
            onClick={() => editor.chain().focus().transformCase(opt.mode).run()}
            className="flex flex-col items-start gap-0.5 py-2"
          >
            <span className="text-xs font-medium">{opt.label}</span>
            <span className="text-[10px] text-muted-foreground">{opt.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
