"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Building2, Unplug, AlertTriangle, Loader2, CheckCircle2, KeyRound } from "lucide-react";
import { useSettingsAutoSave } from "@/hooks/use-settings-auto-save";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";

interface SuperlogicaSettings {
  contaBancariaId: number | null;
  filialId: number;
  contaContabilComissao: string;
  contaContabilDescricao: string;
  tipoImovelPadrao: number;
  tipoPagamentoComissao: number;
  tipoRecebimentoComissao: number;
  emitirNf: boolean;
  gerarDimob: boolean;
  vencimentoDias: number;
  tetoValorCents: number;
}

interface SuperlogicaStatus {
  configured: boolean;
  connected: boolean;
  status: string;
  licenca?: string;
  accountName?: string | null;
  lastValidatedAt?: string | null;
  lastError?: string | null;
  settings: SuperlogicaSettings | null;
}

interface ContaBancaria {
  id: number;
  nome: string;
  movimentos: number;
}

/** Tipos de imóvel da Superlógica (`ST_TIPO_IMO`), subconjunto usado nas vendas. */
const TIPOS_IMOVEL: Array<{ value: number; label: string }> = [
  { value: 1, label: "Casa" },
  { value: 2, label: "Casa em condomínio" },
  { value: 3, label: "Casa comercial" },
  { value: 4, label: "Apartamento" },
  { value: 5, label: "Cobertura" },
  { value: 6, label: "Flat" },
  { value: 7, label: "Sala comercial" },
  { value: 8, label: "Loja" },
  { value: 9, label: "Galpão" },
  { value: 10, label: "Terreno" },
];

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/**
 * Card de conexão e padrões da Superlógica (ERP financeiro da imobiliária).
 * Fluxo: colar licença + app token + access token → validamos nas duas APIs
 * e gravamos cifrado. Conectada, aparecem os padrões da exportação de venda
 * (auto-save via `useSettingsAutoSave`, o mesmo hook das outras seções de
 * /settings) e o botão "Reconectar" (troca de tokens sem perder os padrões).
 * Os tokens nunca voltam do servidor; só status e metadados.
 */
export function SuperlogicaConnectCard() {
  const [state, setState] = useState<SuperlogicaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [contas, setContas] = useState<ContaBancaria[] | null>(null);
  const [contasError, setContasError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/superlogica");
      if (res.ok) setState(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!state?.configured) return;
    let cancelled = false;
    fetch("/api/settings/superlogica/contas")
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setContasError(d.error ?? "Não foi possível listar as contas bancárias.");
          return;
        }
        setContas(d.contas ?? []);
        setContasError(null);
      })
      .catch(() => {
        if (!cancelled) setContasError("Não foi possível listar as contas bancárias.");
      });
    return () => {
      cancelled = true;
    };
  }, [state?.configured, state?.lastValidatedAt]);

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/superlogica", { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Falha ao desconectar");
      }
      setContas(null);
      toast.success("Superlógica desconectada.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/superlogica/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Falha no teste");
      toast.success("Tokens válidos nas duas APIs da Superlógica.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no teste");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const configured = Boolean(state?.configured);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          Superlógica (ERP financeiro)
          {state?.connected && (
            <Badge variant="secondary" className="ml-2">
              Conectada
            </Badge>
          )}
          {configured && state?.status === "error" && (
            <Badge variant="destructive" className="ml-2">
              Com erro
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : !configured ? (
          <>
            <p className="text-sm text-muted-foreground">
              Conecte a licença da imobiliária para enviar vendas fechadas (imóvel,
              comprador, comissionados e parcelas da comissão) direto para o módulo
              Vendas da Superlógica. Os tokens ficam cifrados e nunca são exibidos.
            </p>
            <TokenForm
              busy={busy}
              setBusy={setBusy}
              onDone={refresh}
              submitLabel="Conectar"
              initialLicenca=""
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                Licença <span className="font-mono">{state?.licenca}</span>
              </span>
              {state?.accountName && <span>{state.accountName}</span>}
              {state?.lastValidatedAt && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5" /> validada em{" "}
                  {new Date(state.lastValidatedAt).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
            {state?.lastError && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {state.lastError}
              </p>
            )}

            {showTokenForm ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Trocar tokens</p>
                <p className="text-xs text-muted-foreground">
                  Os padrões abaixo são preservados. Use quando o access token for renovado
                  na Superlógica.
                </p>
                <TokenForm
                  busy={busy}
                  setBusy={setBusy}
                  onDone={async () => {
                    setShowTokenForm(false);
                    await refresh();
                  }}
                  submitLabel="Reconectar"
                  initialLicenca={state?.licenca ?? ""}
                  onCancel={() => setShowTokenForm(false)}
                />
              </div>
            ) : null}

            {state?.settings && (
              <SettingsSection
                // Remonta (e zera a baseline do auto-save) quando a conta muda.
                key={`${state.licenca}:${state.lastValidatedAt ?? ""}`}
                initial={state.settings}
                contas={contas}
                contasError={contasError}
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={test} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Testar conexão
              </Button>
              {!showTokenForm && (
                <Button variant="outline" onClick={() => setShowTokenForm(true)} disabled={busy}>
                  <KeyRound className="mr-2 h-4 w-4" /> Reconectar
                </Button>
              )}
              <Button variant="ghost" onClick={disconnect} disabled={busy}>
                <Unplug className="mr-2 h-4 w-4" /> Desconectar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Formulário de licença + tokens (conectar e reconectar usam o mesmo POST). */
function TokenForm({
  busy,
  setBusy,
  onDone,
  submitLabel,
  initialLicenca,
  onCancel,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => Promise<void> | void;
  submitLabel: string;
  initialLicenca: string;
  onCancel?: () => void;
}) {
  const [licenca, setLicenca] = useState(initialLicenca);
  const [appToken, setAppToken] = useState("");
  const [accessToken, setAccessToken] = useState("");

  async function submit() {
    if (licenca.trim().length < 3 || appToken.trim().length < 8 || accessToken.trim().length < 8) {
      toast.error("Preencha licença, app token e access token.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/superlogica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenca: licenca.trim(),
          appToken: appToken.trim(),
          accessToken: accessToken.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao conectar");
      setAppToken("");
      setAccessToken("");
      toast.success(
        data.accountName ? `Superlógica conectada (${data.accountName}).` : "Superlógica conectada."
      );
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao conectar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="sl-licenca">Licença</Label>
          <Input
            id="sl-licenca"
            placeholder="adm037585"
            value={licenca}
            onChange={(e) => setLicenca(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-app">App token</Label>
          <Input
            id="sl-app"
            type="password"
            autoComplete="off"
            value={appToken}
            onChange={(e) => setAppToken(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-access">Access token</Label>
          <Input
            id="sl-access"
            type="password"
            autoComplete="off"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Na Superlógica: Empresa › Usuários › Aplicativos › seu aplicativo. O app token é do
        aplicativo; o access token é da licença.
      </p>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

/** "" → NaN (inválido, não viaja); "12" → 12. */
function toInt(raw: string): number {
  if (raw.trim() === "") return Number.NaN;
  const n = Number(raw);
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * Padrões da exportação. Campos numéricos guardam a STRING digitada (o
 * `Number("") === 0` é a armadilha conhecida da área); o hook recebe os
 * números derivados e `invalidKeys` segura o que está vazio/fora da faixa até
 * o admin terminar de digitar.
 */
function SettingsSection({
  initial,
  contas,
  contasError,
}: {
  initial: SuperlogicaSettings;
  contas: ContaBancaria[] | null;
  contasError: string | null;
}) {
  const [contaBancariaId, setContaBancariaId] = useState<number | null>(initial.contaBancariaId);
  const [contaManual, setContaManual] = useState("");
  const [filialId, setFilialId] = useState(String(initial.filialId));
  const [contaContabilComissao, setContaContabilComissao] = useState(initial.contaContabilComissao);
  const [contaContabilDescricao, setContaContabilDescricao] = useState(
    initial.contaContabilDescricao
  );
  const [tipoImovelPadrao, setTipoImovelPadrao] = useState(initial.tipoImovelPadrao);
  const [tipoPagamentoComissao, setTipoPagamentoComissao] = useState(initial.tipoPagamentoComissao);
  const [tipoRecebimentoComissao, setTipoRecebimentoComissao] = useState(
    initial.tipoRecebimentoComissao
  );
  const [emitirNf, setEmitirNf] = useState(initial.emitirNf);
  const [gerarDimob, setGerarDimob] = useState(initial.gerarDimob);
  const [vencimentoDias, setVencimentoDias] = useState(String(initial.vencimentoDias));
  const [tetoReais, setTetoReais] = useState(String(Math.round(initial.tetoValorCents / 100)));

  const fields = {
    contaBancariaId,
    filialId: toInt(filialId),
    contaContabilComissao: contaContabilComissao.trim(),
    contaContabilDescricao: contaContabilDescricao.trim(),
    tipoImovelPadrao,
    tipoPagamentoComissao,
    tipoRecebimentoComissao,
    emitirNf,
    gerarDimob,
    vencimentoDias: toInt(vencimentoDias),
    tetoValorCents: Number.isNaN(toInt(tetoReais)) ? Number.NaN : toInt(tetoReais) * 100,
  };

  const autoSave = useSettingsAutoSave(fields, {
    endpoint: "/api/settings/superlogica",
    debounceMs: 600,
    invalidKeys: (f) => {
      const bad: string[] = [];
      if (f.contaBancariaId !== null && !(f.contaBancariaId >= 1)) bad.push("contaBancariaId");
      if (!(f.filialId >= 0)) bad.push("filialId");
      if (!f.contaContabilComissao) bad.push("contaContabilComissao");
      if (!f.contaContabilDescricao) bad.push("contaContabilDescricao");
      if (!(f.vencimentoDias >= 0 && f.vencimentoDias <= 365)) bad.push("vencimentoDias");
      if (!(f.tetoValorCents >= 0 && f.tetoValorCents <= 2_000_000_000)) bad.push("tetoValorCents");
      return bad;
    },
  });

  const contaConhecida = contaBancariaId !== null && contas?.some((c) => c.id === contaBancariaId);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Padrões da exportação de venda</p>
        <SaveStatusPill status={autoSave.status} isDirty={autoSave.isDirty} />
      </div>
      {autoSave.error && <p className="text-xs text-destructive">{autoSave.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sl-conta">Conta bancária das parcelas</Label>
          <select
            id="sl-conta"
            className={SELECT_CLASS}
            value={contaBancariaId ?? ""}
            onChange={(e) => setContaBancariaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— escolher —</option>
            {contas?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({c.movimentos} mov.)
              </option>
            ))}
            {contaBancariaId !== null && !contaConhecida && (
              <option value={contaBancariaId}>Conta {contaBancariaId}</option>
            )}
          </select>
          {contasError && <p className="text-xs text-destructive">{contasError}</p>}
          <div className="flex items-center gap-2">
            <Input
              aria-label="Id de outra conta bancária"
              placeholder="ou id da conta"
              className="h-8 w-32"
              inputMode="numeric"
              value={contaManual}
              onChange={(e) => setContaManual(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!(toInt(contaManual) >= 1)}
              onClick={() => {
                setContaBancariaId(toInt(contaManual));
                setContaManual("");
              }}
            >
              Usar id
            </Button>
          </div>
          {contaBancariaId === null && (
            <p className="text-xs text-amber-700">
              Obrigatória: sem conta, a exportação fica bloqueada no preview.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Lista vinda dos lançamentos recentes do caixa; conta sem movimento pode ser informada
            pelo id.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-tipo-imovel">Tipo de imóvel padrão</Label>
          <select
            id="sl-tipo-imovel"
            className={SELECT_CLASS}
            value={tipoImovelPadrao}
            onChange={(e) => setTipoImovelPadrao(Number(e.target.value))}
          >
            {TIPOS_IMOVEL.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-quem-paga">Quem paga os comissionados</Label>
          <select
            id="sl-quem-paga"
            className={SELECT_CLASS}
            value={tipoPagamentoComissao}
            onChange={(e) => setTipoPagamentoComissao(Number(e.target.value))}
          >
            <option value={0}>Imobiliária</option>
            <option value={1}>Cliente</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-recebe">Comissão recebida de</Label>
          <select
            id="sl-recebe"
            className={SELECT_CLASS}
            value={tipoRecebimentoComissao}
            onChange={(e) => setTipoRecebimentoComissao(Number(e.target.value))}
          >
            <option value={0}>Vendedor (proprietário)</option>
            <option value={1}>Comprador</option>
          </select>
          <p className="text-xs text-muted-foreground">
            O formulário de venda pode sobrescrever (campo &quot;quem paga&quot;).
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-venc">Vencimento padrão (dias após a venda)</Label>
          <Input
            id="sl-venc"
            inputMode="numeric"
            value={vencimentoDias}
            onChange={(e) => setVencimentoDias(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">0 a 365.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-teto">Teto por exportação (R$, inteiro)</Label>
          <Input
            id="sl-teto"
            inputMode="numeric"
            value={tetoReais}
            onChange={(e) => setTetoReais(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-conta-cont">Conta contábil da comissão a pagar</Label>
          <div className="flex gap-2">
            <Input
              id="sl-conta-cont"
              className="w-28"
              value={contaContabilComissao}
              onChange={(e) => setContaContabilComissao(e.target.value)}
            />
            <Input
              aria-label="Descrição da conta contábil"
              value={contaContabilDescricao}
              onChange={(e) => setContaContabilDescricao(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sl-filial">Filial (0 = Matriz)</Label>
          <Input
            id="sl-filial"
            inputMode="numeric"
            value={filialId}
            onChange={(e) => setFilialId(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={emitirNf} onChange={(e) => setEmitirNf(e.target.checked)} />
          Emitir nota fiscal pelo sistema
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={gerarDimob}
            onChange={(e) => setGerarDimob(e.target.checked)}
          />
          Gerar DIMOB
        </label>
      </div>
    </div>
  );
}
