"use client";

import { useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link as LinkIcon,
  Highlighter,
  Sparkles,
  MessageSquarePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

interface EditorBubbleMenuProps {
  editor: Editor;
  onAskAI?: (selectedText: string) => void;
  onAddComment?: (selectedText: string) => void;
}

function MenuButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`h-8 w-8 p-0 ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </Button>
  );
}

export function EditorBubbleMenu({
  editor,
  onAskAI,
  onAddComment,
}: EditorBubbleMenuProps) {
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);

  function getSelectedText(): string {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, " ");
  }

  function applyLink() {
    const url = linkUrl.trim();
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
    setLinkPopoverOpen(false);
    setLinkUrl("");
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top" }}
      shouldShow={({ editor, from, to }) => {
        if (from === to) return false;
        return editor.isEditable;
      }}
    >
      <div className="flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md">
        <MenuButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Negrito (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Itálico (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Sublinhado (Ctrl+U)"
        >
          <UnderlineIcon className="h-4 w-4" />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Tachado"
        >
          <Strikethrough className="h-4 w-4" />
        </MenuButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Link"
              aria-label="Inserir link"
              onClick={() => {
                const current = editor.getAttributes("link").href || "";
                setLinkUrl(current);
              }}
              className={`h-8 w-8 p-0 ${editor.isActive("link") ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <div className="flex gap-2">
              <Input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyLink();
                  }
                }}
                placeholder="https://..."
                className="h-8"
              />
              <Button type="button" size="sm" onClick={applyLink}>
                OK
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <MenuButton
          onClick={() =>
            editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run()
          }
          active={editor.isActive("highlight")}
          title="Marcador"
        >
          <Highlighter className="h-4 w-4" />
        </MenuButton>

        {onAddComment && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <MenuButton
              onClick={() => {
                const text = getSelectedText();
                if (text) onAddComment(text);
              }}
              title="Comentar"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </MenuButton>
          </>
        )}

        {onAskAI && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const text = getSelectedText();
                if (text) onAskAI(text);
              }}
              title="Perguntar à IA"
              className="h-8 px-2 gap-1 text-primary hover:text-primary hover:bg-primary/10"
            >
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium">IA</span>
            </Button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
