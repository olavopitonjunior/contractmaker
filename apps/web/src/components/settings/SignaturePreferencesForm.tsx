"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const AUTH_METHODS = ["email", "whatsapp", "selfie", "icp_brasil"] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];

const METHOD_LABELS: Record<AuthMethod, string> = {
  email: "E-mail (token)",
  whatsapp: "WhatsApp",
  selfie: "Selfie + documento",
  icp_brasil: "ICP-Brasil (certificado)",
};

interface Settings {
  monthlyBudgetCents: number | null;
  costOverridesJson: Record<string, number> | null;
  defaultAuthMethod: AuthMethod;
  allowedAuthMethods: AuthMethod[];
  defaultLocale: string;
  autoClose: boolean;
  refusable: boolean;
  defaultDeadlineDays: number | null;
  defaultSequential: boolean;
  proposalEmailSubject: string | null;
  proposalEmailMessage: string | null;
}

const reais = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2);
const toCents = (v: string): number | null => {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
};

/**
 * Preferências de assinatura por org: tipos de assinatura habilitados + método
 * padrão, orçamento mensal, custo por método e padrões de envelope. Valem para
 * todos os envios (contrato, locação, avulso).
 */
export function SignaturePreferencesForm() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [overrides, setOverrides] = useState<Record<AuthMethod, string>>({
    email: "",
    whatsapp: "",
    selfie: "",
    icp_brasil: "",
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/signature-preferences");
        if (res.ok) {
          const { settings } = await res.json();
          setS(settings);
          setBudget(reais(settings.monthlyBudgetCents));
          setDeadline(
            settings.defaultDeadlineDays == null
              ? ""
              : String(settings.defaultDeadlineDays)
          );
          setOverrides({
            email: reais(settings.costOverridesJson?.email),
            whatsapp: reais(settings.costOverridesJson?.whatsapp),
            selfie: reais(settings.costOverridesJson?.selfie),
            icp_brasil: reais(settings.costOverridesJson?.icp_brasil),
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleAllowed(m: AuthMethod) {
    if (!s) return;
    const has = s.allowedAuthMethods.includes(m);
    let next = has
      ? s.allowedAuthMethods.filter((x) => x !== m)
      : [...s.allowedAuthMethods, m];
    if (next.length === 0) {
      toast.error("Mantenha ao menos um método habilitado.");
      return;
    }
    // Se o método padrão saiu da lista, cai no primeiro permitido.
    const defaultAuthMethod = next.includes(s.defaultAuthMethod)
      ? s.defaultAuthMethod
      : next[0];
    setS({ ...s, allowedAuthMethods: next, defaultAuthMethod });
  }

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      const costOverridesJson: Record<string, number> = {};
      for (const m of AUTH_METHODS) {
        const c = toCents(overrides[m]);
        if (c != null) costOverridesJson[m] = c;
      }
      const res = await fetch("/api/settings/signature-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyBudgetCents: toCents(budget),
          costOverridesJson:
            Object.keys(costOverridesJson).length > 0 ? costOverridesJson : null,
          defaultAuthMethod: s.defaultAuthMethod,
          allowedAuthMethods: s.allowedAuthMethods,
          defaultLocale: s.defaultLocale,
          autoClose: s.autoClose,
          refusable: s.refusable,
          defaultDeadlineDays:
            deadline.trim() === "" ? null : Math.max(1, Number(deadline)),
          defaultSequential: s.defaultSequential,
          proposalEmailSubject: s.proposalEmailSubject || null,
          proposalEmailMessage: s.proposalEmailMessage || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Falha ao salvar");
      toast.success("Preferências de assinatura salvas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !s) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tipos de assinatura</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Métodos habilitados</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {AUTH_METHODS.map((m) => (
                <label
                  key={m}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={s.allowedAuthMethods.includes(m)}
                    onChange={() => toggleAllowed(m)}
                  />
                  {METHOD_LABELS[m]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="defaultMethod" className="text-xs">
              Método padrão
            </Label>
            <select
              id="defaultMethod"
              value={s.defaultAuthMethod}
              onChange={(e) =>
                setS({ ...s, defaultAuthMethod: e.target.value as AuthMethod })
              }
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {s.allowedAuthMethods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Orçamento e custo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="budget" className="text-xs">
              Orçamento mensal (R$) — vazio usa o padrão da plataforma
            </Label>
            <Input
              id="budget"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Ex.: 100,00"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">
              Custo por assinatura (R$) — sobrescreve a estimativa por método
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {AUTH_METHODS.map((m) => (
                <div key={m} className="flex items-center gap-2">
                  <span className="w-40 text-xs text-muted-foreground">
                    {METHOD_LABELS[m]}
                  </span>
                  <Input
                    inputMode="decimal"
                    value={overrides[m]}
                    onChange={(e) =>
                      setOverrides({ ...overrides, [m]: e.target.value })
                    }
                    placeholder="padrão"
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Padrões de envelope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">Assinatura em ordem (sequencial)</p>
              <p className="text-xs text-muted-foreground">
                Cada signatário só é notificado após o anterior assinar.
              </p>
            </div>
            <Switch
              checked={s.defaultSequential}
              onCheckedChange={(v) => setS({ ...s, defaultSequential: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">Permitir recusa</p>
              <p className="text-xs text-muted-foreground">
                Signatário pode recusar a assinatura.
              </p>
            </div>
            <Switch
              checked={s.refusable}
              onCheckedChange={(v) => setS({ ...s, refusable: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">Fechar automaticamente</p>
              <p className="text-xs text-muted-foreground">
                Encerra o envelope quando todos assinam.
              </p>
            </div>
            <Switch
              checked={s.autoClose}
              onCheckedChange={(v) => setS({ ...s, autoClose: v })}
            />
          </div>
          <div>
            <Label htmlFor="deadline" className="text-xs">
              Prazo padrão (dias) — vazio = sem prazo
            </Label>
            <Input
              id="deadline"
              inputMode="numeric"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              placeholder="Ex.: 15"
            />
          </div>
          <div className="space-y-1 border-t pt-3">
            <Label htmlFor="propSubject" className="text-xs">
              Assunto da notificação das propostas — vazio = padrão da ClickSign
            </Label>
            <Input
              id="propSubject"
              value={s.proposalEmailSubject ?? ""}
              onChange={(e) => setS({ ...s, proposalEmailSubject: e.target.value })}
              placeholder="Proposta nº {{numero}} — assine"
            />
            <Label htmlFor="propMessage" className="text-xs pt-2 block">
              Mensagem da notificação das propostas
            </Label>
            <Textarea
              id="propMessage"
              rows={3}
              value={s.proposalEmailMessage ?? ""}
              onChange={(e) => setS({ ...s, proposalEmailMessage: e.target.value })}
              placeholder="Olá! Você recebeu a proposta {{titulo}} para assinatura."
            />
            <p className="text-xs text-muted-foreground">
              Placeholders: {"{{numero}}"} {"{{proponente}}"} {"{{imovel}}"} {"{{titulo}}"}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch("/api/settings/clicksign/recheck-capabilities", {
                method: "POST",
              });
              const d = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
              toast.success(
                `Recursos verificados — assinatura WhatsApp: ${d.whatsappSignatureAvailable ? "sim" : "não"}`
              );
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Erro ao verificar");
            } finally {
              setBusy(false);
            }
          }}
        >
          Reverificar recursos (WhatsApp)
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…
            </>
          ) : (
            "Salvar preferências"
          )}
        </Button>
      </div>
    </div>
  );
}
