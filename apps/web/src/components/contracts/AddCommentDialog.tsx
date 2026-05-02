"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface AddCommentDialogProps {
  open: boolean;
  /** Trecho selecionado pelo BubbleMenu (TipTap). Em modo GDocs vem string vazia. */
  selectedText: string;
  onClose: () => void;
  /** TipTap: chama com texto do comment; GDocs: chama com texto + trecho editado. */
  onSubmit: (text: string, overrideSelectedText?: string) => Promise<void> | void;
  /** Quando true, usuário precisa colar/digitar o trecho de referência. */
  requireSelectedTextInput?: boolean;
}

export function AddCommentDialog({
  open,
  selectedText,
  onClose,
  onSubmit,
  requireSelectedTextInput = false,
}: AddCommentDialogProps) {
  const [text, setText] = useState("");
  const [trecho, setTrecho] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setText("");
      setTrecho(selectedText || "");
    }
  }, [open, selectedText]);

  const finalSelected = requireSelectedTextInput ? trecho.trim() : selectedText;
  const canSubmit =
    text.trim().length > 0 &&
    (!requireSelectedTextInput || finalSelected.length >= 8);

  async function handleSave() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit(
        text.trim(),
        requireSelectedTextInput ? finalSelected : undefined
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo comentário</DialogTitle>
          <DialogDescription>
            {requireSelectedTextInput
              ? "Cole o trecho exato do contrato (Google Doc) sobre o qual você quer comentar."
              : "O comentário ficará vinculado ao trecho selecionado."}
          </DialogDescription>
        </DialogHeader>

        {requireSelectedTextInput ? (
          <div className="space-y-2">
            <Label htmlFor="add-comment-trecho" className="text-xs">
              Trecho de referência (mínimo 8 caracteres)
            </Label>
            <Textarea
              id="add-comment-trecho"
              value={trecho}
              onChange={(e) => setTrecho(e.target.value)}
              placeholder="Cole aqui o texto exato do contrato…"
              className="min-h-[60px] text-xs"
            />
          </div>
        ) : (
          <blockquote className="text-xs italic text-muted-foreground border-l-2 border-muted pl-3 max-h-24 overflow-y-auto">
            {selectedText}
          </blockquote>
        )}

        <div className="space-y-2">
          <Label htmlFor="add-comment-text" className="text-xs">
            Comentário
          </Label>
          <Textarea
            id="add-comment-text"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Digite seu comentário…"
            className="min-h-[100px]"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !canSubmit}>
            {saving ? "Salvando…" : "Comentar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
