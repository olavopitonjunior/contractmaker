"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Dialog reusável pra enviar o resumo consolidado do formulário por e-mail
 * (PDF + documentos anexados) e/ou baixar só o PDF. Autenticado — bate nos
 * endpoints deal-level. Usado no DealDetail e na lista de formulários.
 */
export function SendFormSummaryDialog({
  dealId,
  defaultEmail,
  triggerLabel = "Enviar resumo",
  triggerVariant = "outline",
  triggerSize = "sm",
}: {
  dealId: string;
  defaultEmail?: string | null;
  triggerLabel?: string;
  triggerVariant?: "outline" | "default" | "ghost" | "secondary";
  triggerSize?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleSend() {
    if (!email.trim()) {
      toast.error("Informe um e-mail de destino");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/form-summary/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email.trim(), includeAttachments }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(
          data.attachmentsSkipped
            ? "E-mail enviado (anexos omitidos por tamanho)"
            : "Resumo enviado por e-mail"
        );
        setOpen(false);
      } else {
        toast.error(data.error || "Falha ao enviar o resumo");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSending(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/form-summary/pdf`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.pdfUrl) {
        window.open(data.pdfUrl, "_blank");
        toast.success("PDF gerado");
      } else {
        toast.error(data.error || "Falha ao gerar o PDF");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <Mail className="mr-1 h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar resumo do formulário</DialogTitle>
          <DialogDescription>
            Gera um PDF consolidado com todos os dados preenchidos e envia por
            e-mail, com os documentos anexados ao formulário.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="fs-email">E-mail de destino</Label>
            <Input
              id="fs-email"
              type="email"
              placeholder="destinatario@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="fs-attachments"
              checked={includeAttachments}
              onCheckedChange={(v) => setIncludeAttachments(v === true)}
            />
            <Label htmlFor="fs-attachments" className="text-sm font-normal">
              Incluir documentos anexados
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Baixar PDF
          </Button>
          <Button type="button" onClick={handleSend} disabled={sending}>
            {sending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-1 h-4 w-4" />
            )}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
