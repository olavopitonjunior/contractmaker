"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface InviteRow {
  id: string;
  recipientRole: string;
  recipientName: string | null;
  recipientEmail: string | null;
  channel: string;
  status: string;
  url: string;
  sentAt: string | null;
  respondedAt: string | null;
  remindersSent: number;
  template: { name: string; version: number };
  response: { npsScore: number | null; csatScore: number | null } | null;
}

interface SuggestedRecipient {
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-muted text-muted-foreground" },
  sent: { label: "Enviada", className: "bg-blue-100 text-blue-900" },
  responded: { label: "Respondida", className: "bg-green-100 text-green-900" },
  expired: { label: "Expirada", className: "bg-amber-100 text-amber-900" },
  optout: { label: "Cancelou", className: "bg-neutral-200 text-neutral-700" },
  failed: { label: "Falhou", className: "bg-red-100 text-red-900" },
};

const ROLE_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  locador: "Locador",
  locatario: "Locatário",
  corretor: "Corretor",
};

export function DealSurveysTab({ dealId }: { dealId: string }) {
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/surveys/invites?dealId=${dealId}`, {
      credentials: "same-origin",
    });
    if (res.ok) {
      const data = await res.json();
      setInvites(data.invites);
    } else {
      setInvites([]);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resend(inviteId: string) {
    setBusy(inviteId);
    try {
      const res = await fetch(`/api/surveys/invites/${inviteId}/resend`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? "Falha no reenvio");
      else {
        toast.success("Pesquisa reenviada");
        void load();
      }
    } finally {
      setBusy(null);
    }
  }

  function copyLink(url: string) {
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Link copiado"),
      () => toast.error("Não foi possível copiar")
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Pesquisas de satisfação enviadas às partes e ao corretor deste negócio.
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Send className="mr-1 h-3.5 w-3.5" /> Enviar pesquisa
            </Button>
          </DialogTrigger>
          <SendSurveyDialogContent
            dealId={dealId}
            open={dialogOpen}
            onSent={() => {
              setDialogOpen(false);
              void load();
            }}
          />
        </Dialog>
      </div>

      {invites === null && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {invites?.length === 0 && (
        <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          Nenhuma pesquisa enviada neste negócio ainda.
        </p>
      )}

      {invites?.map((invite) => {
        const status = STATUS_META[invite.status] ?? STATUS_META.pending;
        return (
          <div
            key={invite.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {invite.recipientName ?? invite.recipientEmail ?? "—"}
                </span>
                <Badge variant="outline">
                  {ROLE_LABEL[invite.recipientRole] ?? invite.recipientRole}
                </Badge>
                <span className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {invite.template.name} (v{invite.template.version})
                {invite.channel === "email" && invite.recipientEmail
                  ? ` · ${invite.recipientEmail}`
                  : invite.channel === "manual"
                    ? " · link manual"
                    : ""}
                {invite.remindersSent > 0 && ` · ${invite.remindersSent} lembrete(s)`}
              </p>
              {invite.response && (
                <p className="mt-0.5 flex items-center gap-2 text-xs">
                  {invite.response.npsScore !== null && (
                    <span
                      className={
                        invite.response.npsScore <= 6
                          ? "font-medium text-red-600"
                          : invite.response.npsScore <= 8
                            ? "font-medium text-amber-600"
                            : "font-medium text-green-600"
                      }
                    >
                      NPS {invite.response.npsScore}/10
                    </span>
                  )}
                  {invite.response.csatScore !== null && (
                    <span className="inline-flex items-center gap-0.5 font-medium">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {invite.response.csatScore}/5
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyLink(invite.url)}
                title="Copiar link da pesquisa"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              {invite.channel === "email" &&
                invite.status !== "responded" &&
                invite.status !== "optout" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === invite.id}
                    onClick={() => resend(invite.id)}
                    title="Reenviar por e-mail"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SendSurveyDialogContent({
  dealId,
  open,
  onSent,
}: {
  dealId: string;
  open: boolean;
  onSent: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; version: number }>
  >([]);
  const [recipients, setRecipients] = useState<SuggestedRecipient[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [channel, setChannel] = useState<"email" | "manual">("email");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [manualLinks, setManualLinks] = useState<Array<{ recipient: string; url: string }>>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setManualLinks([]);
    fetch(`/api/surveys/recipients?dealId=${dealId}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        setTemplates(data.templates);
        setRecipients(data.recipients);
        setTemplateId(data.templates[0]?.id ?? "");
        setChecked(
          new Set(
            data.recipients
              .map((r: SuggestedRecipient, i: number) => (r.email ? i : -1))
              .filter((i: number) => i >= 0)
          )
        );
      })
      .catch(() => toast.error("Falha ao carregar destinatários"))
      .finally(() => setLoading(false));
  }, [open, dealId]);

  const selected = useMemo(
    () => recipients.filter((_, i) => checked.has(i)),
    [recipients, checked]
  );

  async function submit() {
    if (!templateId || selected.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/surveys/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          templateId,
          dealId,
          channel,
          recipients: selected.map((r) => ({
            role: r.role,
            name: r.name,
            email: r.email,
            phone: r.phone,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao enviar");
        return;
      }
      const created = (data.results ?? []).filter(
        (r: { status: string }) => r.status === "created"
      );
      const dupes = (data.results ?? []).filter(
        (r: { status: string }) => r.status === "duplicate"
      );
      if (channel === "manual") {
        setManualLinks(
          created.map((r: { recipient: string; url: string }) => ({
            recipient: r.recipient,
            url: r.url,
          }))
        );
        if (created.length > 0) {
          toast.success("Links gerados — copie e envie");
          return; // mantém o dialog aberto mostrando os links
        }
      } else if (created.length > 0) {
        toast.success(`${created.length} pesquisa(s) enviada(s)`);
      }
      if (dupes.length > 0) {
        toast.info(`${dupes.length} destinatário(s) já tinham recebido este lote`);
      }
      if (channel === "email" || created.length === 0) onSent();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Enviar pesquisa de satisfação</DialogTitle>
      </DialogHeader>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Nenhuma pesquisa ativa. Crie uma em Pesquisas → Nova pesquisa.
        </p>
      ) : manualLinks.length > 0 ? (
        <div className="space-y-2">
          {manualLinks.map((link) => (
            <div
              key={link.url}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="truncate">{link.recipient}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link.url)
                    .then(() => toast.success("Link copiado"))
                }
              >
                <Copy className="mr-1 h-3 w-3" /> Copiar
              </Button>
            </div>
          ))}
          <Button className="w-full" variant="secondary" onClick={onSent}>
            Concluir
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Pesquisa</p>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha a pesquisa" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} (v{t.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Destinatários</p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {recipients.map((recipient, i) => (
                <label
                  key={`${recipient.role}-${i}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={checked.has(i)}
                    onCheckedChange={(v) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (v) next.add(i);
                        else next.delete(i);
                        return next;
                      })
                    }
                    disabled={channel === "email" && !recipient.email}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {recipient.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {ROLE_LABEL[recipient.role] ?? recipient.role}
                      {recipient.email
                        ? ` · ${recipient.email}`
                        : channel === "email"
                          ? " · sem e-mail"
                          : ""}
                    </span>
                  </span>
                </label>
              ))}
              {recipients.length === 0 && (
                <p className="py-2 text-xs text-muted-foreground">
                  Nenhum destinatário identificado no negócio.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={channel === "email" ? "default" : "outline"}
              size="sm"
              onClick={() => setChannel("email")}
            >
              <Mail className="mr-1 h-3.5 w-3.5" /> Enviar por e-mail
            </Button>
            <Button
              variant={channel === "manual" ? "default" : "outline"}
              size="sm"
              onClick={() => setChannel("manual")}
            >
              <Link2 className="mr-1 h-3.5 w-3.5" /> Gerar link manual
            </Button>
          </div>

          <Button
            className="w-full"
            disabled={submitting || !templateId || selected.length === 0}
            onClick={submit}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : channel === "email" ? (
              `Enviar pra ${selected.length} destinatário(s)`
            ) : (
              `Gerar ${selected.length} link(s)`
            )}
          </Button>
        </div>
      )}
    </DialogContent>
  );
}
