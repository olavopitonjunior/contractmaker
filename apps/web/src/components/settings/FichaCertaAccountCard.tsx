"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldCheck, Unplug, AlertTriangle, RefreshCw } from "lucide-react";

export interface FichaCertaCardState {
  connected: boolean;
  status: string;
  label: string | null;
  login: string | null;
  environment: "producao" | "homologacao" | null;
  products: number[] | null;
  costCents: number | null;
  webhookUrl: string | null;
  tokenUrl: string | null;
  webhookProvisioned: boolean;
  lastValidatedAtLabel: string | null;
  lastError: string | null;
}

/**
 * Card de conexão da conta Ficha Certa Digital da imobiliária (análise de
 * crédito para locação). Molde do GoogleDriveCard: estado inicial vem do
 * server; conectar/testar/desconectar batem em /api/settings/fichacerta.
 * A senha só transita no POST de conexão — nunca é exibida de volta.
 */
export function FichaCertaAccountCard({ initial }: { initial: FichaCertaCardState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!initial.connected);
  const [login, setLogin] = useState(initial.login ?? "");
  const [password, setPassword] = useState("");
  const [environment, setEnvironment] = useState<"producao" | "homologacao">(
    initial.environment ?? "producao"
  );
  const [products, setProducts] = useState((initial.products ?? [1, 9]).join(","));
  const [credits, setCredits] = useState<number | null>(null);

  async function reload() {
    const res = await fetch("/api/settings/fichacerta", { credentials: "include" });
    if (!res.ok) return;
    const d = await res.json();
    setState((s) => ({
      ...s,
      connected: !!d.connected,
      status: d.status,
      label: d.label,
      login: d.login,
      environment: d.environment,
      products: d.products,
      costCents: d.costCents,
      webhookUrl: d.webhookUrl,
      tokenUrl: d.tokenUrl,
      webhookProvisioned: !!d.webhookProvisioned,
      lastValidatedAtLabel: d.lastValidatedAt ? new Date(d.lastValidatedAt).toLocaleString("pt-BR") : s.lastValidatedAtLabel,
      lastError: d.lastError,
    }));
  }

  async function connect() {
    if (!login.trim() || !password) {
      toast.error("Informe login e senha da API.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/fichacerta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password, environment, products }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fieldErrors = d.issues?.fieldErrors as Record<string, string[]> | undefined;
        const first = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
        throw new Error(first ?? d.error ?? "Falha ao conectar");
      }
      setCredits(typeof d.credits === "number" ? d.credits : null);
      setPassword("");
      setEditing(false);
      await reload();
      toast.success(
        d.webhookProvisioned
          ? "Ficha Certa conectada e webhook provisionado."
          : "Ficha Certa conectada. O webhook não foi provisionado — use Testar/Reconectar."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao conectar");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/fichacerta/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Teste falhou");
      setCredits(typeof d.credits === "number" ? d.credits : null);
      toast.success(
        `Conexão OK — ${d.credits} crédito(s) disponíveis${
          d.webhookMatches === false ? " · webhook lá aponta para outro endereço" : ""
        }.`
      );
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Teste falhou");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/fichacerta", { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Falha ao desconectar");
      }
      setCredits(null);
      setEditing(true);
      await reload();
      toast.success("Ficha Certa desconectada.");
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
          <ShieldCheck className="h-4 w-4" />
          Ficha Certa Digital — análise de crédito (locação)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Conta da imobiliária na Ficha Certa. Cada laudo consome créditos pré-pagos da conta;
          a análise de crédito na proposta de locação só funciona com a conta conectada e a
          feature “Análise de crédito — locação” ligada para a imobiliária.
        </p>

        {state.lastError && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.lastError}</span>
          </div>
        )}

        {state.connected && !editing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">
                  {state.login}
                  <span className="ml-2 text-muted-foreground">
                    ({state.environment === "homologacao" ? "homologação" : "produção"})
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Produtos {(state.products ?? []).join(", ")} · custo estimado por laudo R${" "}
                  {((state.costCents ?? 0) / 100).toFixed(2).replace(".", ",")}
                  {credits != null ? ` · ${credits} crédito(s)` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    state.status === "error"
                      ? "border-red-300 bg-red-50 text-red-700"
                      : "border-green-300 bg-green-50 text-green-700"
                  }
                >
                  {state.status === "error" ? "Com erro" : "Conectada"}
                </Badge>
                <Button variant="outline" size="sm" onClick={test} disabled={busy}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Testar
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
                  Reconectar
                </Button>
                <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
                  <Unplug className="mr-1 h-3.5 w-3.5" />
                  Desconectar
                </Button>
              </div>
            </div>
            <div className="rounded-md border p-3 text-xs text-muted-foreground">
              <p>
                Webhook:{" "}
                <span className={state.webhookProvisioned ? "text-green-700" : "text-amber-700"}>
                  {state.webhookProvisioned ? "provisionado na Ficha Certa" : "NÃO provisionado — Reconectar"}
                </span>
              </p>
              {state.webhookUrl && <p className="break-all">Endpoint: {state.webhookUrl}</p>}
              {state.tokenUrl && <p className="break-all">Token URL: {state.tokenUrl}</p>}
              {state.lastValidatedAtLabel && <p>Última verificação: {state.lastValidatedAtLabel}</p>}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fc-login">Login da API</Label>
              <Input
                id="fc-login"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="login@imobiliaria.com.br"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fc-password">Senha da API</Label>
              <Input
                id="fc-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="nunca é exibida de volta"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fc-environment">Ambiente</Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as "producao" | "homologacao")}>
                <SelectTrigger id="fc-environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="producao">Produção (api.fichacertadigital.com.br)</SelectItem>
                  <SelectItem value="homologacao">Homologação (stage-api.fichacertadigital.com.br)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fc-products">Produtos contratados (ids)</Label>
              <Input
                id="fc-products"
                value={products}
                onChange={(e) => setProducts(e.target.value.replace(/\s+/g, ""))}
                placeholder="1,9"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Ids separados por vírgula, sem espaço. 1 = FC REPORT · 9 = FC SCORE · 10 = FC SCORE+
              </p>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button size="sm" onClick={connect} disabled={busy}>
                {state.connected ? "Salvar e reconectar" : "Conectar"}
              </Button>
              {state.connected && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
