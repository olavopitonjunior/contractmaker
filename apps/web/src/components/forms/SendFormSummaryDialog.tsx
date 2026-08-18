"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface OrgMemberOption {
  email: string;
  name: string | null;
}

/**
 * Dialog reusável pra enviar o resumo consolidado do formulário por e-mail
 * (PDF + documentos anexados) e/ou baixar só o PDF. Autenticado — bate nos
 * endpoints deal-level. O destino é restrito a membros da org (o resumo é
 * dossiê interno; nunca vai pras partes). Usado no DealDetail e na lista de
 * formulários.
 */
export function SendFormSummaryDialog({
  dealId,
  triggerLabel = "Enviar resumo",
  triggerVariant = "outline",
  triggerSize = "sm",
}: {
  dealId: string;
  triggerLabel?: string;
  triggerVariant?: "outline" | "default" | "ghost" | "secondary";
  triggerSize?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<OrgMemberOption[] | null>(null);
  const [email, setEmail] = useState("");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || members !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/org/members");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list: OrgMemberOption[] = Array.isArray(data.members)
          ? data.members
              .map((m: { user?: { email?: string; name?: string | null } }) => ({
                email: m.user?.email ?? "",
                name: m.user?.name ?? null,
              }))
              .filter((m: OrgMemberOption) => m.email)
          : [];
        setMembers(list);
      } catch {
        if (!cancelled) setMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, members]);

  async function handleSend() {
    if (!email) {
      toast.error("Selecione o destinatário");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/form-summary/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email, includeAttachments }),
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Falha ao gerar o PDF");
        return;
      }
      // Download via blob same-origin: window.open(url) depois de um fetch
      // assíncrono caía no popup blocker (1º clique "sumia") e abria o blob
      // público com nome feio em vez de baixar.
      const blob = await res.blob();
      const filename =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "resumo-formulario.pdf";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revogar síncrono pode abortar o download em Safari/Firefox (a blob:
      // URL resolve assíncrono depois do click).
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      toast.success("PDF baixado");
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
            e-mail para um usuário do sistema, com os documentos anexados ao
            formulário.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="fs-email">Destinatário (usuário do sistema)</Label>
            <Select value={email} onValueChange={setEmail}>
              <SelectTrigger id="fs-email">
                <SelectValue
                  placeholder={
                    members === null ? "Carregando..." : "Selecione um usuário"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(members ?? []).map((m) => (
                  <SelectItem key={m.email} value={m.email}>
                    {m.name ? `${m.name} — ${m.email}` : m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {members !== null && members.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhum membro encontrado na organização.
              </p>
            )}
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
