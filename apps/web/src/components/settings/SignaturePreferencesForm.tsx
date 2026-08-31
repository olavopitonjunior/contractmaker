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
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";
import { useSettingsAutoSave } from "@/hooks/use-settings-auto-save";

const AUTH_METHODS = ["email", "whatsapp", "selfie", "icp_brasil"] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];

const METHOD_LABELS: Record<AuthMethod, string> = {
  email: "E-mail (token)",
  whatsapp: "WhatsApp",
  selfie: "Selfie + documento",
  icp_brasil: "ICP-Brasil (certificado)",
};

interface Settings {
  defaultAuthMethod: AuthMethod;
  allowedAuthMethods: AuthMethod[];
  defaultLocale: string;
  autoClose: boolean;
  refusable: boolean;
  defaultDeadlineDays: number | null;
  defaultSequential: boolean;
  proposalEmailSubject: string | null;
  proposalEmailMessage: string | null;
  proposalAutoChainVendedor: boolean;
  proposalOwnerDeadlineDays: number | null;
}

/** Limites do Zod da rota (`signature-preferences/route.ts`). */
const MAX_ASSUNTO = 200;
const MAX_MENSAGEM = 2000;
const MAX_PRAZO = 365;

/**
 * Campo de prazo vazio significa "sem prazo" (null). Fora isso tem que ser
 * inteiro de 1 a 365 — a faixa que a rota aceita.
 *
 * O código antigo fazia `Math.max(1, Number(x))`, que tem dois furos: texto
 * não-numérico virava `NaN` e era serializado como `null`, apagando o prazo em
 * silêncio; e não havia teto, então "9999" ia para a rota e voltava 400.
 */
function erroDePrazo(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n)) return "Use um número inteiro de dias.";
  if (n < 1 || n > MAX_PRAZO) return `Use de 1 a ${MAX_PRAZO} dias.`;
  return null;
}

function prazoParaApi(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

/**
 * Preferências de assinatura por org: tipos de assinatura habilitados + método
 * padrão e padrões de envelope. Valem para todos os envios (contrato, locação,
 * avulso). Sem orçamento nem custo — ver lib/clicksign/quota.ts.
 */
export function SignaturePreferencesForm() {
  const [inicial, setInicial] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/signature-preferences");
        if (res.ok) {
          const { settings } = await res.json();
          setInicial(settings);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || !inicial) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando preferências…
        </CardContent>
      </Card>
    );
  }

  // O editor só monta com os dados JÁ carregados. É condição do auto-save: a
  // baseline do hook é capturada no primeiro render, e montá-lo com `s = null`
  // fazia toda a configuração parecer "suja" assim que o GET voltava — um
  // PATCH fantasma reescrevia 6-8 campos sem ninguém ter tocado em nada, e
  // ainda deixava rastro no audit log de uma tela sensível.
  return <SignaturePreferencesEditor inicial={inicial} />;
}

function SignaturePreferencesEditor({ inicial }: { inicial: Settings }) {
  const [s, setS] = useState<Settings>(inicial);
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState(
    inicial.defaultDeadlineDays == null
      ? ""
      : String(inicial.defaultDeadlineDays),
  );
  const [ownerDeadline, setOwnerDeadline] = useState(
    inicial.proposalOwnerDeadlineDays == null
      ? ""
      : String(inicial.proposalOwnerDeadlineDays),
  );

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

  const deadlineErro = erroDePrazo(deadline);
  const ownerDeadlineErro = erroDePrazo(ownerDeadline);
  const assuntoLongo = (s.proposalEmailSubject?.length ?? 0) > MAX_ASSUNTO;
  const mensagemLonga = (s.proposalEmailMessage?.length ?? 0) > MAX_MENSAGEM;

  // UMA instância para a tela inteira, de propósito. `allowedAuthMethods` e
  // `defaultAuthMethod` têm invariante cruzada checada no servidor contra a
  // linha atual (TOCTOU): separá-los em instâncias diferentes faria desmarcar
  // da lista o método que é o padrão virar 400 no meio da edição. Na mesma
  // instância eles viajam no mesmo corpo sempre que ambos mudam — que é
  // exatamente o que `toggleAllowed` faz ao rebaixar o padrão.
  const autoSave = useSettingsAutoSave(
    {
      defaultAuthMethod: s.defaultAuthMethod,
      allowedAuthMethods: s.allowedAuthMethods,
      defaultLocale: s.defaultLocale,
      autoClose: s.autoClose,
      refusable: s.refusable,
      defaultSequential: s.defaultSequential,
      defaultDeadlineDays: prazoParaApi(deadline),
      proposalEmailSubject: s.proposalEmailSubject || null,
      proposalEmailMessage: s.proposalEmailMessage || null,
      proposalAutoChainVendedor: s.proposalAutoChainVendedor,
      proposalOwnerDeadlineDays: prazoParaApi(ownerDeadline),
    },
    {
      endpoint: "/api/settings/signature-preferences",
      isValid: () =>
        !deadlineErro &&
        !ownerDeadlineErro &&
        !assuntoLongo &&
        !mensagemLonga &&
        s.allowedAuthMethods.length > 0 &&
        s.allowedAuthMethods.includes(s.defaultAuthMethod),
    },
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Tipos de assinatura</CardTitle>
            {/* Uma pill só: as três seções compartilham a mesma unidade de
                salvamento (ver o comentário do hook acima). */}
            <SaveStatusPill status={autoSave.status} isDirty={autoSave.isDirty} />
          </div>
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

      {/* O card "Orçamento e custo" saiu: não existe mais teto de gasto, e os
          valores por método alimentavam uma estimativa que não correspondia ao
          que a ClickSign cobra. O limite real é o do plano da conta. */}

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
              onBlur={() => void autoSave.flush()}
              placeholder="Ex.: 15"
              aria-invalid={!!deadlineErro}
            />
            {deadlineErro && (
              <p className="text-xs text-destructive mt-1">
                {deadlineErro} Ainda não foi salvo.
              </p>
            )}
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Propostas — via do proprietário</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">Enviar ao proprietário automaticamente</p>
              <p className="text-xs text-muted-foreground">
                Desligado (padrão): quando o proponente assina, a proposta para e
                VOCÊ decide — enviar a 2ª via ao proprietário ou concluir sem
                enviar. Ligado: a 2ª via é enviada na hora, sem parada.
              </p>
            </div>
            <Switch
              checked={s.proposalAutoChainVendedor}
              onCheckedChange={(v) => setS({ ...s, proposalAutoChainVendedor: v })}
            />
          </div>
          <div>
            <Label htmlFor="ownerDeadline" className="text-xs">
              Prazo da via do proprietário (dias) — vazio = 7
            </Label>
            <Input
              id="ownerDeadline"
              inputMode="numeric"
              value={ownerDeadline}
              onChange={(e) => setOwnerDeadline(e.target.value)}
              onBlur={() => void autoSave.flush()}
              placeholder="7"
              aria-invalid={!!ownerDeadlineErro}
            />
            {ownerDeadlineErro && (
              <p className="text-xs text-destructive mt-1">
                {ownerDeadlineErro} Ainda não foi salvo.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              A via do proprietário ganha prazo próprio: o maior entre a validade
              da proposta e hoje + este prazo.
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
      </div>
    </div>
  );
}
