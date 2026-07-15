"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  FileSignature,
  Unplug,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";

interface ClickSignStatus {
  connected: boolean;
  configured: boolean;
  usesLegacyGlobal: boolean;
  status: string;
  label: string | null;
  accountName: string | null;
  baseUrl: string | null;
  webhookUrl: string | null;
  webhookProvisioned: boolean;
  hasWebhookSecret: boolean;
  lastValidatedAt: string | null;
  lastError: string | null;
}

/**
 * Card didático de conexão da conta ClickSign da imobiliária. Fluxo de 1 passo:
 * colar o token → validamos e registramos o webhook automaticamente. Sem conta
 * conectada, a org não envia documentos pra assinatura (salvo a org legada, que
 * usa a conta global da plataforma).
 */
export function ClickSignConnectCard() {
  const [state, setState] = useState<ClickSignStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/settings/clicksign");
      if (res.ok) setState(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function connect() {
    if (token.trim().length < 8) {
      toast.error("Cole um token de API válido da ClickSign.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/clicksign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), label: label.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao conectar");
      setToken("");
      if (data.webhookProvisioned && !data.needsManualSecret) {
        toast.success("ClickSign conectada e webhook registrado automaticamente.");
      } else if (data.needsManualSecret) {
        toast.warning(
          "Conta conectada, mas precisamos do secret do webhook — cole abaixo."
        );
      } else {
        toast.success("ClickSign conectada.");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao conectar");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/clicksign", { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Falha ao desconectar");
      }
      toast.success("ClickSign desconectada.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar");
    } finally {
      setBusy(false);
    }
  }

  async function reprovision() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/clicksign/provision-webhook", {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Falha ao provisionar");
      toast.success(
        d.needsManualSecret
          ? "Webhook registrado. Cole o secret do webhook (painel ClickSign)."
          : "Webhook registrado na sua conta ClickSign."
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao provisionar");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/clicksign/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Falha no teste");
      toast.success(
        d.webhookRegistered
          ? "Token válido e webhook registrado. Tudo certo!"
          : "Token válido, mas o webhook não foi encontrado na conta."
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no teste");
    } finally {
      setBusy(false);
    }
  }

  async function saveManualSecret() {
    if (manualSecret.trim().length < 8) {
      toast.error("Cole o secret do webhook gerado na ClickSign.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/clicksign/webhook-secret", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: manualSecret.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Falha ao salvar secret");
      }
      setManualSecret("");
      toast.success("Secret do webhook salvo.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar secret");
    } finally {
      setBusy(false);
    }
  }

  function copyWebhookUrl() {
    if (!state?.webhookUrl) return;
    navigator.clipboard.writeText(state.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </CardContent>
      </Card>
    );
  }

  const connected = state?.connected;
  const needsManualSecret = connected && !state?.hasWebhookSecret;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSignature className="h-4 w-4" />
          Conta ClickSign da imobiliária
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">
                  {state?.label || state?.accountName || "Conta conectada"}
                </p>
                <p className="text-muted-foreground">
                  Os envelopes de assinatura são enviados por esta conta.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-green-300 bg-green-50 text-green-700"
                >
                  Conectada
                </Badge>
                <Button variant="outline" size="sm" onClick={test} disabled={busy}>
                  Testar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disconnect}
                  disabled={busy}
                >
                  <Unplug className="mr-1 h-3.5 w-3.5" />
                  Desconectar
                </Button>
              </div>
            </div>

            {state?.webhookUrl && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="mb-1 font-medium">URL de webhook desta conta</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">
                    {state.webhookUrl}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={copyWebhookUrl}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {state.webhookProvisioned
                    ? "Registrado automaticamente na sua conta ClickSign."
                    : "Ainda não registrado na ClickSign — clique em Reprovisionar para registrar automaticamente."}
                </p>
                {!state.webhookProvisioned && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={reprovision}
                    disabled={busy}
                  >
                    Reprovisionar webhook
                  </Button>
                )}
              </div>
            )}

            {needsManualSecret && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Falta o <strong>secret do webhook</strong>. Copie o HMAC
                    secret que a ClickSign gerou ao cadastrar o webhook e cole
                    aqui — sem ele os eventos de assinatura são rejeitados.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={manualSecret}
                    onChange={(e) => setManualSecret(e.target.value)}
                    placeholder="HMAC secret do webhook"
                    className="bg-background"
                  />
                  <Button size="sm" onClick={saveManualSecret} disabled={busy}>
                    Salvar
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rounded-md border border-info/30 bg-info/10 p-3 text-sm">
              <p className="font-medium">Como conectar (leva 1 minuto)</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                <li>
                  Entre na ClickSign e vá em{" "}
                  <strong>Configurações › API</strong>.
                </li>
                <li>
                  Gere um <strong>token de acesso</strong> (Access Token).
                </li>
                <li>Cole o token abaixo e clique em Conectar.</li>
                <li>
                  Registramos o webhook automaticamente — você não precisa
                  configurar mais nada.
                </li>
              </ol>
              <a
                href="https://ajuda.clicksign.com/article/api"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
              >
                Abrir ajuda da ClickSign <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {state?.usesLegacyGlobal && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                Hoje esta organização usa a conta ClickSign da plataforma
                (legado). Conecte a conta própria para assinar em nome da sua
                imobiliária.
              </div>
            )}

            <div className="space-y-2">
              <div>
                <Label htmlFor="cs-token" className="text-xs">
                  Token de API
                </Label>
                <Input
                  id="cs-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Cole o Access Token da ClickSign"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="cs-label" className="text-xs">
                  Apelido (opcional)
                </Label>
                <Input
                  id="cs-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Conta principal"
                />
              </div>
              <Button onClick={connect} disabled={busy} className="w-full">
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Conectando…
                  </>
                ) : (
                  "Conectar ClickSign"
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
