"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { List } from "lucide-react";

interface TocEntry {
  level: number;
  text: string;
  pos: number;
}

interface Props {
  editor: Editor | null;
}

export function TableOfContents({ editor }: Props) {
  const [entries, setEntries] = useState<TocEntry[]>([]);

  useEffect(() => {
    if (!editor) return;
    const computeEntries = () => {
      const list: TocEntry[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          list.push({
            level: node.attrs.level,
            text: node.textContent,
            pos,
          });
        }
      });
      setEntries(list);
    };
    computeEntries();
    const handler = () => computeEntries();
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  function scrollTo(pos: number) {
    if (!editor) return;
    editor.commands.focus();
    editor.commands.setTextSelection(pos);
    editor.view.dispatch(editor.state.tr.scrollIntoView());
  }

  if (entries.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        <List className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Nenhum cabeçalho (H1/H2/H3) encontrado.</p>
        <p className="mt-1">Use Heading 1-3 na toolbar para criar seções e gerar o sumário.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-8rem)]">
      <div className="p-3 space-y-0.5">
        {entries.map((entry, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => scrollTo(entry.pos)}
            className="w-full text-left rounded px-2 py-1 text-xs hover:bg-muted transition-colors truncate"
            style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
            title={entry.text}
          >
            {entry.text || "(vazio)"}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
