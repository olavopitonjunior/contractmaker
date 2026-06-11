"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Copy, MessageCircle, Users } from "lucide-react";
import type { ParticipantRole } from "@/lib/forms/participant-token";

export const PARTY_ROLE_LABELS: Record<ParticipantRole, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
};

interface PartyLink {
  role: ParticipantRole;
  url: string;
  completedAt: string | null;
}

export interface PartyLinksPanelProps {
  /** Token PRINCIPAL do form — os subtokens são derivados dele (from-main). */
  formToken: string;
  /** Papéis oferecidos (venda: vendedor/comprador; locação: locador/locatario/fiador). */
  roles: ParticipantRole[];
  /** Compacto = embutido em dialog/success screen. */
  compact?: boolean;
}

/**
 * Links por parte: cada papel ganha um link exclusivo onde a pessoa preenche
 * só a própria qualificação + documentos — sem ver a outra parte nem as
 * condições do negócio. Usa POST /participants/from-main (idempotente, também
 * funciona pro corretor logado). Reaproveitado na tela de sucesso da criação
 * (venda e locação) e no header do detalhe.
 */
export function PartyLinksPanel({ formToken, roles, compact = false }: PartyLinksPanelProps) {
  const [links, setLinks] = useState<PartyLink[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedRole, setCopiedRole] = useState<string | null>(null);

  async function ensureLinks(): Promise<PartyLink[] | null> {
    if (links) return links;
    setBusy(true);
    try {
      const res = await fetch(`/api/forms/${formToken}/participants/from-main`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao gerar links por parte");
        return null;
      }
      const next: PartyLink[] = (data.participants || []).map(
        (p: { role: ParticipantRole; url: string; completedAt: string | null }) => ({
          role: p.role,
          url: `${window.location.origin}${p.url}`,
          completedAt: p.completedAt,
        })
      );
      setLinks(next);
      return next;
    } catch {
      toast.error("Erro de conexão");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function copyLink(link: PartyLink) {
    navigator.clipboard.writeText(link.url);
    setCopiedRole(link.role);
    toast.success(`Link do ${PARTY_ROLE_LABELS[link.role].toLowerCase()} copiado!`);
    setTimeout(() => setCopiedRole(null), 2000);
  }

  function whatsapp(link: PartyLink) {
    const msg = `Olá! Para seguirmos com o negócio, preencha seus dados como ${PARTY_ROLE_LABELS[link.role].toLowerCase()} neste link exclusivo: ${link.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  if (!links) {
    return (
      <div className={compact ? "" : "rounded-lg border p-4"}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Cada parte pode preencher os próprios dados por um link exclusivo —
              sem ver a outra parte nem as condições do negócio.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={ensureLinks} disabled={busy}>
            {busy ? "Gerando…" : "Gerar links por parte"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "rounded-lg border p-4 space-y-2"}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" /> Links por parte (validade 7 dias)
      </p>
      {links.map((link) => (
        <div
          key={link.role}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium">{PARTY_ROLE_LABELS[link.role]}</span>
            {link.completedAt ? (
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400">
                Preencheu
              </Badge>
            ) : (
              <Badge variant="outline">Aguardando</Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => copyLink(link)}
              title="Copiar link"
            >
              {copiedRole === link.role ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => whatsapp(link)}
              title="Enviar por WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface SharePartyLinkButtonProps {
  /** Token PRINCIPAL do form. */
  formToken: string;
  role: ParticipantRole;
}

/**
 * Botão "Pedir para esta pessoa preencher" — embutido no header dos steps de
 * parte dos wizards (só na visão do token principal). Gera o subtoken na hora
 * e copia o link.
 */
export function SharePartyLinkButton({ formToken, role }: SharePartyLinkButtonProps) {
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      const res = await fetch(`/api/forms/${formToken}/participants/from-main`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: [role] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao gerar o link");
        return;
      }
      const p = (data.participants || []).find(
        (x: { role: string }) => x.role === role
      );
      if (!p) {
        toast.error("Link não encontrado");
        return;
      }
      const url = `${window.location.origin}${p.url}`;
      await navigator.clipboard.writeText(url);
      toast.success(
        `Link exclusivo do ${PARTY_ROLE_LABELS[role].toLowerCase()} copiado — envie pra pessoa preencher esta parte.`
      );
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-xs text-muted-foreground"
      onClick={share}
      disabled={busy}
      title={`Gera um link exclusivo onde o ${PARTY_ROLE_LABELS[role].toLowerCase()} preenche só os próprios dados`}
    >
      <Users className="h-3.5 w-3.5 mr-1" />
      {busy ? "Gerando…" : "Pedir para esta pessoa preencher"}
    </Button>
  );
}
