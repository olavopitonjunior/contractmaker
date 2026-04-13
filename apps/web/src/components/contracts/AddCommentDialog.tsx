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

interface AddCommentDialogProps {
  open: boolean;
  selectedText: string;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void> | void;
}

export function AddCommentDialog({
  open,
  selectedText,
  onClose,
  onSubmit,
}: AddCommentDialogProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onSubmit(text.trim());
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
            O comentário ficará vinculado ao trecho selecionado.
          </DialogDescription>
        </DialogHeader>

        <blockquote className="text-xs italic text-muted-foreground border-l-2 border-muted pl-3 max-h-24 overflow-y-auto">
          {selectedText}
        </blockquote>

        <Textarea
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

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !text.trim()}>
            {saving ? "Salvando…" : "Comentar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
