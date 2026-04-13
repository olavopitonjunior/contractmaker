"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronUp,
  ChevronDown,
  Replace,
  ReplaceAll,
  X,
  CaseSensitive,
  WholeWord,
} from "lucide-react";

interface FindReplaceBarProps {
  editor: Editor;
  open: boolean;
  onClose: () => void;
}

export function FindReplaceBar({ editor, open, onClose }: FindReplaceBarProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const storage = editor.storage.searchReplace as
    | { results: Array<{ from: number; to: number }>; currentIndex: number }
    | undefined;
  const total = storage?.results.length ?? 0;
  const current = total > 0 ? (storage?.currentIndex ?? -1) + 1 : 0;

  useEffect(() => {
    if (open) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else {
      editor.commands.clearSearch();
    }
  }, [open, editor]);

  useEffect(() => {
    if (!open) return;
    editor.commands.setSearchTerm(searchTerm);
  }, [searchTerm, open, editor]);

  useEffect(() => {
    if (!open) return;
    editor.commands.setSearchOptions({ caseSensitive, wholeWord });
  }, [caseSensitive, wholeWord, open, editor]);

  useEffect(() => {
    if (!open) return;
    editor.commands.setReplaceTerm(replaceTerm);
  }, [replaceTerm, open, editor]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sticky top-[72px] z-30 border-b bg-card shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) editor.commands.previousResult();
                else editor.commands.nextResult();
              }
            }}
            placeholder="Buscar"
            className="h-8 w-56"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[60px]">
            {total > 0 ? `${current} de ${total}` : "0 resultados"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => editor.commands.previousResult()}
            disabled={total === 0}
            title="Anterior (Shift+Enter)"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => editor.commands.nextResult()}
            disabled={total === 0}
            title="Próximo (Enter)"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Input
            value={replaceTerm}
            onChange={(e) => setReplaceTerm(e.target.value)}
            placeholder="Substituir"
            className="h-8 w-56"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => editor.commands.replaceCurrent()}
            disabled={total === 0}
            title="Substituir"
          >
            <Replace className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => editor.commands.replaceAll()}
            disabled={total === 0}
            title="Substituir todos"
          >
            <ReplaceAll className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <Button
            type="button"
            variant={caseSensitive ? "secondary" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setCaseSensitive((v) => !v)}
            title="Diferenciar maiúsculas/minúsculas"
          >
            <CaseSensitive className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={wholeWord ? "secondary" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setWholeWord((v) => !v)}
            title="Palavra inteira"
          >
            <WholeWord className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
