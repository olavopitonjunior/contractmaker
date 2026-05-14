"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

interface Participant {
  id: string;
  role: string;
  partyIndex: number;
  token: string;
  tokenExp: string;
  completedAt: string | null;
  lastAccessAt: string | null;
}

interface ShareByPartyClientProps {
  formToken: string;
  mainFormUrl: string;
  initialParticipants: Participant[];
}

const ROLE_LABEL: Record<string, string> = {
  vendedor: "Vendedor(a)",
  comprador: "Comprador(a)",
};

function urlFor(token: string) {
  if (typeof window === "undefined") return `/f/p/${token}`;
  return `${window.location.origin}/f/p/${token}`;
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / (24 * 60 * 60 * 1000));
  if (abs < 60 * 1000) return diff > 0 ? "agora" : "há instantes";
  if (abs < 60 * 60 * 1000) {
    const min = Math.floor(abs / (60 * 1000));
    return diff > 0 ? `em ${min} min` : `há ${min} min`;
  }
  if (abs < 24 * 60 * 60 * 1000) {
    const h = Math.floor(abs / (60 * 60 * 1000));
    return diff > 0 ? `em ${h}h` : `há ${h}h`;
  }
  return diff > 0 ? `em ${days}d` : `há ${days}d`;
}

export function ShareByPartyClient({
  formToken,
  mainFormUrl,
  initialParticipants,
}: ShareByPartyClientProps) {
  const [participants, setParticipants] = useState(initialParticipants);
  const [busy, setBusy] = useState<string | null>(null);

  const byRole = (role: string) => participants.find((p) => p.role === role);

  async function ensureParticipants() {
    setBusy("create");
    try {
      const res = await fetch(`/api/forms/${formToken}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roles: ["vendedor", "comprador"] }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Falha ao criar links");
        return;
      }
      setParticipants(data.participants);
      toast.success("Links gerados");
    } catch {
      toast.error("Erro de rede");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(participantId: string) {
    setBusy(participantId);
    try {
      const res = await fetch(
        `/api/forms/${formToken}/participants/${participantId}/regenerate`,
        { method: "POST", credentials: "include" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Falha ao regenerar");
        return;
      }
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === participantId
            ? { ...p, token: data.token, tokenExp: data.tokenExp }
            : p,
        ),
      );
      toast.success("Link regenerado");
    } catch {
      toast.error("Erro de rede");
    } finally {
      setBusy(null);
    }
  }

  function copyLink(token: string) {
    const url = urlFor(token);
    navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  }

  function whatsappLink(token: string, role: string): string {
    const url = urlFor(token);
    const label = ROLE_LABEL[role] ?? role;
    const msg = encodeURIComponent(
      `Olá! Para finalizarmos o negócio, preciso que você preencha seus dados como ${label} neste link exclusivo:\n\n${url}\n\nObrigado!`,
    );
    return `https://wa.me/?text=${msg}`;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Link completo (admin)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Acesso a todos os campos. Use só pra você ou um corretor de
            confiança — não envie pras partes.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 min-w-[200px] truncate">
              {mainFormUrl}
            </code>
            <Button asChild variant="outline" size="sm">
              <a href={mainFormUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" />
                Abrir
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {participants.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Nenhum link por parte criado ainda.
            </p>
            <Button onClick={ensureParticipants} disabled={busy === "create"}>
              {busy === "create" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Gerar links de vendedor e comprador
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(["vendedor", "comprador"] as const).map((role) => {
            const p = byRole(role);
            if (!p) {
              return (
                <Card key={role}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {ROLE_LABEL[role]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Sem link gerado pra essa parte.
                    </p>
                    <Button
                      onClick={ensureParticipants}
                      disabled={busy === "create"}
                      size="sm"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Gerar link
                    </Button>
                  </CardContent>
                </Card>
              );
            }
            const url = urlFor(p.token);
            const status = p.completedAt
              ? { label: "Completo", color: "default" as const }
              : p.lastAccessAt
                ? { label: "Em andamento", color: "secondary" as const }
                : { label: "Não iniciado", color: "outline" as const };
            return (
              <Card key={role}>
                <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-sm">{ROLE_LABEL[role]}</CardTitle>
                  <Badge variant={status.color}>{status.label}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <button
                    type="button"
                    onClick={() => copyLink(p.token)}
                    className="w-full truncate rounded border border-dashed bg-muted/40 px-2 py-1.5 text-left text-[11px] font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Clique para copiar"
                  >
                    {url.replace(/^https?:\/\//, "")}
                  </button>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Expira {relativeTime(p.tokenExp)}</p>
                    {p.lastAccessAt && (
                      <p>Último acesso: {relativeTime(p.lastAccessAt)}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyLink(p.token)}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copiar
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={whatsappLink(p.token, role)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="h-3 w-3 mr-1" />
                        WhatsApp
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => regenerate(p.id)}
                      disabled={busy === p.id}
                    >
                      {busy === p.id ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-1" />
                      )}
                      Regenerar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
