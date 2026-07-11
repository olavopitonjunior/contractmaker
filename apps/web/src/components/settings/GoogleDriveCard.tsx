"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CloudUpload, Unplug, AlertTriangle } from "lucide-react";

interface GoogleDriveState {
  connected: boolean;
  status: string;
  email: string | null;
  lastErrorMessage: string | null;
}

/**
 * Card de conexão do Google Drive da imobiliária. Conectado, os templates e
 * contratos passam a ser criados no Drive da própria org (identidade visual
 * e quota isoladas por tenant). Sem conexão, vale a conta global da
 * plataforma (comportamento legado).
 */
const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  redirect_uri_mismatch:
    "A configuração do app Google (cliente OAuth) não bate com este endereço. Avise o suporte.",
  token_exchange:
    "O Google recusou a troca de credenciais. Tente novamente; se persistir, avise o suporte.",
  no_refresh_token:
    "O Google não devolveu a autorização completa. Reconecte marcando as permissões solicitadas.",
  no_email: "Não foi possível ler o e-mail da conta Google. Tente com outra conta.",
  access_denied: "Você cancelou a autorização no Google. Clique em Conectar para tentar de novo.",
};

function connectErrorMessage(code: string): string {
  return (
    CONNECT_ERROR_MESSAGES[code] ??
    "Não foi possível conectar o Google. Tente novamente; se persistir, avise o suporte."
  );
}

export function GoogleDriveCard({
  initial,
  connectError = null,
}: {
  initial: GoogleDriveState;
  connectError?: string | null;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/google", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Falha ao desconectar");
      }
      setState({ connected: false, status: "disconnected", email: null, lastErrorMessage: null });
      toast.success("Google Drive desconectado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudUpload className="h-4 w-4" />
          Google Drive da imobiliária
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {connectError && !state.connected && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{connectErrorMessage(connectError)}</span>
          </div>
        )}
        {state.status === "revoked" && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              O acesso foi revogado no Google ({state.email}). Os documentos
              voltaram a ser criados na conta da plataforma — reconecte para
              restaurar o Drive da imobiliária.
              {state.lastErrorMessage && (
                <p className="mt-1 text-xs opacity-80">{state.lastErrorMessage}</p>
              )}
            </div>
          </div>
        )}

        {state.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium">{state.email}</p>
              <p className="text-muted-foreground">
                Templates e contratos são criados no Drive desta conta.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
                Conectado
              </Badge>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
                <Unplug className="mr-1 h-3.5 w-3.5" />
                Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Conecte a conta Google da imobiliária para que os modelos de
              contrato e os documentos gerados fiquem no Drive de vocês, com a
              identidade visual preservada.
            </p>
            <Button asChild size="sm">
              {/* Navegação full-page: o endpoint redireciona pro consent do Google */}
              <a href="/api/settings/google/connect">Conectar Google</a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
