"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import CharacterCount from "@tiptap/extension-character-count";
import Typography from "@tiptap/extension-typography";
import { SearchReplace } from "@/lib/editor/SearchReplace";
import { CommentMark } from "@/lib/editor/CommentMark";
import { SuggestionMark } from "@/lib/editor/SuggestionMark";
import { PageBreakNode } from "@/lib/editor/PageBreakNode";
import { FontSize } from "@/lib/editor/FontSize";
import { LineHeight } from "@/lib/editor/LineHeight";
import { TextTransform } from "@/lib/editor/TextTransform";
import { FormatPainter } from "@/lib/editor/FormatPainter";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { useEffect, useState, forwardRef, useImperativeHandle } from "react";
import type { Editor } from "@tiptap/react";
import { FindReplaceBar } from "./FindReplaceBar";
import { SuggestionsToolbar } from "./SuggestionsToolbar";
import { FontFamilyDropdown } from "./FontFamilyDropdown";
import { FontSizeDropdown } from "./FontSizeDropdown";
import { ColorPicker } from "./ColorPicker";
import { LineHeightDropdown } from "./LineHeightDropdown";
import { TextTransformMenu } from "./TextTransformMenu";
import { ZoomControl } from "./ZoomControl";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  Undo,
  Redo,
  Link as LinkIcon,
  Table as TableIcon,
  Minus,
  Search,
  IndentIncrease,
  IndentDecrease,
  FileText,
  Paintbrush,
} from "lucide-react";
import { EditorBubbleMenu } from "./EditorBubbleMenu";

interface ContractEditorProps {
  content: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  onAskAI?: (selectedText: string) => void;
  onAddComment?: (selectedText: string) => void;
  contractId?: string;
  suggestionsVersion?: number;
}

export interface ContractEditorHandle {
  applyCommentMark: (commentId: string) => void;
  removeCommentMark: (commentId: string) => void;
  scrollToComment: (commentId: string) => void;
  focus: () => void;
  getHTML: () => string;
  getEditor: () => Editor | null;
}

export const ContractEditor = forwardRef<ContractEditorHandle, ContractEditorProps>(
  function ContractEditor(
    {
      content,
      onChange,
      readOnly,
      onAskAI,
      onAddComment,
      contractId,
      suggestionsVersion = 0,
    },
    ref
  ) {
    const [findOpen, setFindOpen] = useState(false);
    const [zoom, setZoom] = useState(100);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: {
            class: "text-primary underline underline-offset-2",
            rel: "noopener noreferrer",
          },
        },
      }),
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize,
      LineHeight,
      TextTransform,
      FormatPainter,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      CharacterCount,
      Typography,
      SearchReplace.configure({
        searchResultClass: "search-result",
        activeResultClass: "search-result-active",
      }),
      CommentMark,
      SuggestionMark,
      PageBreakNode,
    ],
    content,
    immediatelyRender: false,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      if (!readOnly) onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[400px] sm:min-h-[600px] p-4 sm:p-8 md:p-12",
        spellcheck: "true",
        lang: "pt-BR",
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  useImperativeHandle(
    ref,
    () => ({
      applyCommentMark: (commentId: string) => {
        if (!editor) return;
        editor.chain().focus().setCommentMark({ commentId }).run();
      },
      removeCommentMark: (commentId: string) => {
        if (!editor) return;
        editor.chain().focus().unsetCommentMark(commentId).run();
      },
      scrollToComment: (commentId: string) => {
        if (typeof document === "undefined") return;
        const el = document.querySelector(`[data-comment-id="${commentId}"]`);
        if (el && el instanceof HTMLElement) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("comment-active");
          setTimeout(() => el.classList.remove("comment-active"), 1500);
        }
      },
      focus: () => {
        editor?.chain().focus().run();
      },
      getHTML: () => editor?.getHTML() ?? "",
      getEditor: () => editor,
    }),
    [editor]
  );

  useEffect(() => {
    if (readOnly) return;
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [readOnly]);

  if (!editor) return null;

  const charCount = editor.storage.characterCount?.characters?.() ?? 0;
  const wordCount = editor.storage.characterCount?.words?.() ?? 0;

  function ToolbarButton({
    onClick,
    active,
    disabled,
    tooltip,
    children,
  }: {
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    tooltip: string;
    children: React.ReactNode;
  }) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClick}
            disabled={disabled}
            aria-label={tooltip}
            className={`h-8 w-8 p-0 ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  function GroupSeparator() {
    return <Separator orientation="vertical" className="mx-1 h-5" />;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col">
        {/* Toolbar - sticky below the page header */}
        <div className="sticky top-[72px] z-20 flex items-center gap-0.5 px-4 py-2 border-b bg-card/95 backdrop-blur-sm flex-wrap">
          {/* Group: Text */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            tooltip="Negrito (Ctrl+B)"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            tooltip="Itálico (Ctrl+I)"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            tooltip="Sublinhado (Ctrl+U)"
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            tooltip="Tachado (Ctrl+Shift+X)"
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>

          <GroupSeparator />

          {/* Group: Font (family, size, color, highlight) */}
          <FontFamilyDropdown editor={editor} />
          <FontSizeDropdown editor={editor} />
          <ColorPicker editor={editor} variant="text" />
          <ColorPicker editor={editor} variant="highlight" />

          <GroupSeparator />

          {/* Group: Headings */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setParagraph().run()}
            active={editor.isActive("paragraph")}
            tooltip="Parágrafo"
          >
            <Pilcrow className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            tooltip="Título 1 (Ctrl+Alt+1)"
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            tooltip="Título 2 (Ctrl+Alt+2)"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive("heading", { level: 3 })}
            tooltip="Título 3 (Ctrl+Alt+3)"
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>

          <GroupSeparator />

          {/* Group: Lists */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            tooltip="Lista (Ctrl+Shift+8)"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            tooltip="Lista numerada (Ctrl+Shift+7)"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
            disabled={!editor.can().sinkListItem("listItem")}
            tooltip="Aumentar recuo (Tab)"
          >
            <IndentIncrease className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().liftListItem("listItem").run()}
            disabled={!editor.can().liftListItem("listItem")}
            tooltip="Diminuir recuo (Shift+Tab)"
          >
            <IndentDecrease className="h-4 w-4" />
          </ToolbarButton>

          <GroupSeparator />

          {/* Group: Alignment */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            active={editor.isActive({ textAlign: "left" })}
            tooltip="Alinhar à esquerda (Ctrl+Shift+L)"
          >
            <AlignLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            active={editor.isActive({ textAlign: "center" })}
            tooltip="Centralizar (Ctrl+Shift+E)"
          >
            <AlignCenter className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            active={editor.isActive({ textAlign: "right" })}
            tooltip="Alinhar à direita (Ctrl+Shift+R)"
          >
            <AlignRight className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
            active={editor.isActive({ textAlign: "justify" })}
            tooltip="Justificar (Ctrl+Shift+J)"
          >
            <AlignJustify className="h-4 w-4" />
          </ToolbarButton>
          <LineHeightDropdown editor={editor} />
          <TextTransformMenu editor={editor} />
          <ToolbarButton
            onClick={() => editor.chain().focus().copyFormat().run()}
            active={editor.storage.formatPainter?.hasClipboard ?? false}
            tooltip="Copiar formatação (Ctrl+Alt+C) · depois selecione o destino e Ctrl+Alt+V"
          >
            <Paintbrush className="h-4 w-4" />
          </ToolbarButton>

          <GroupSeparator />

          {/* Group: Insert */}
          <ToolbarButton
            onClick={() => {
              const url = window.prompt("URL do link:", editor.getAttributes("link").href || "");
              if (url === null) return;
              if (!url) {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
              } else {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: url, target: "_blank" })
                  .run();
              }
            }}
            active={editor.isActive("link")}
            tooltip="Link (Ctrl+K)"
          >
            <LinkIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
            tooltip="Inserir tabela"
          >
            <TableIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            tooltip="Linha horizontal"
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertPageBreak().run()}
            tooltip="Quebra de página (Ctrl+Enter)"
          >
            <FileText className="h-4 w-4" />
          </ToolbarButton>

          <GroupSeparator />

          {/* Group: Actions */}
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            tooltip="Desfazer (Ctrl+Z)"
          >
            <Undo className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            tooltip="Refazer (Ctrl+Y)"
          >
            <Redo className="h-4 w-4" />
          </ToolbarButton>
          {!readOnly && (
            <ToolbarButton onClick={() => setFindOpen(true)} tooltip="Buscar e substituir (Ctrl+F)">
              <Search className="h-4 w-4" />
            </ToolbarButton>
          )}
        </div>

        {/* Find & Replace bar */}
        {!readOnly && (
          <FindReplaceBar editor={editor} open={findOpen} onClose={() => setFindOpen(false)} />
        )}

        {/* Suggestions toolbar (track changes) */}
        {!readOnly && contractId && (
          <SuggestionsToolbar
            contractId={contractId}
            editor={editor}
            version={suggestionsVersion}
            onContentChange={onChange}
          />
        )}

        {/* Bubble menu */}
        {!readOnly && (
          <EditorBubbleMenu
            editor={editor}
            onAskAI={onAskAI}
            onAddComment={onAddComment}
          />
        )}

        {/* Editor - A4 paper effect with zoom */}
        <div className="bg-muted/40 py-8 px-4 overflow-auto">
          <div
            className="a4-page mx-auto bg-card rounded-sm shadow-md border transition-transform"
            style={{
              transform: zoom === 100 ? undefined : `scale(${zoom / 100})`,
              transformOrigin: "top center",
              marginBottom: zoom > 100 ? `${(zoom - 100) * 11}px` : undefined,
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t bg-card text-xs text-muted-foreground">
          <span>
            {wordCount} {wordCount === 1 ? "palavra" : "palavras"} · {charCount}{" "}
            {charCount === 1 ? "caractere" : "caracteres"}
          </span>
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </div>
      </div>
    </TooltipProvider>
  );
  }
);
