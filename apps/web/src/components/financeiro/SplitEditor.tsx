"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Info, Wallet, KeyRound, Eye, EyeOff, AlertTriangle } from "lucide-react";
import {
  matchComissionadosToSplitRecipients,
  type ComissionadoLike,
} from "@/lib/asaas/commissionados-matcher";
import { SplitRecipientInlineDialog } from "@/components/financeiro/SplitRecipientInlineDialog";

export type RecipientType = "asaas_wallet" | "pix_external";

export interface SplitEntry {
  /** ID local para tracking no form. Não enviado ao Asaas. */
  key: string;
  recipientType: RecipientType;
  /** ID do SplitRecipient do banco (sempre vinculado, exceto manual wallet). */
  recipientId: string | null;
  /** Para asaas_wallet — walletId do beneficiário. */
  walletId: string;
  /** Para pix_external — chave PIX + dados do dono. */
  pixAddressKey: string;
  pixKeyType: string;
  ownerName: string;
  ownerCpfCnpj: string;
  label: string;
  percentualValue: number;
  /** Pagadoria 2026-05-09 — esconder do pagador (consolida valor em outra linha). */
  hiddenFromPayer?: boolean;
  /** ID da linha visível que herda visualmente este valor (default: próxima visível). */
  consolidateInto?: string;
  /**
   * Comissionado fonte (extraído do CCV) que originou esta linha — usado pra
   * exibir alerta "sem cadastro" quando o match falhou e o usuário precisa
   * cadastrar inline antes de prosseguir.
   */
  sourceComissionado?: ComissionadoLike;
}

interface Recipient {
  id: string;
  label: string;
  recipientType: RecipientType;
  walletId: string | null;
  pixAddressKey: string | null;
  pixKeyType: string | null;
  ownerName: string | null;
  ownerCpfCnpj: string | null;
  cpfCnpj: string | null;
  email: string | null;
  active: boolean;
}

interface Props {
  value: SplitEntry[];
  onChange: (v: SplitEntry[]) => void;
  /** Percentual de platform fee (mostra como info, não editável). */
  platformFeePercent?: number;
  /** Valor nominal da cobrança (para preview de rateio em R$). */
  chargeValue?: number;
  disabled?: boolean;
  /**
   * Pagadoria 2026-05-09 — quando passado e `value` está vazio na primeira
   * renderização, popula linhas a partir do match de `comissionados[]` extraídos
   * com `SplitRecipient` cadastrados na org. Linhas sem match aparecem amarelas
   * com CTA pra cadastrar inline.
   */
  seedFromComissionados?: ComissionadoLike[];
  /** Habilita toggle "Esconder do pagador" e select de consolidação. */
  enableHideFromPayer?: boolean;
}

function nextKey() {
  return `split_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const PIX_FEE_ESTIMATE = 1.0;

export default function SplitEditor({
  value,
  onChange,
  platformFeePercent = 0,
  chargeValue = 0,
  disabled,
  seedFromComissionados,
  enableHideFromPayer,
}: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [inlineDialog, setInlineDialog] = useState<
    | null
    | {
        forKey: string;
        prefill: ComissionadoLike;
      }
  >(null);

  async function refreshRecipients() {
    const res = await fetch("/api/financeiro/split-recipients", {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      setRecipients(
        (data.recipients ?? []).filter((r: Recipient) => r.active)
      );
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await refreshRecipients();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Seed inicial a partir de comissionados[] extraídos do CCV
  useEffect(() => {
    if (seeded) return;
    if (loading) return;
    if (!seedFromComissionados || seedFromComissionados.length === 0) return;
    if (value.length > 0) {
      setSeeded(true);
      return;
    }
    const matches = matchComissionadosToSplitRecipients(
      seedFromComissionados,
      recipients as unknown as Parameters<
        typeof matchComissionadosToSplitRecipients
      >[1]
    );
    const seededLines: SplitEntry[] = matches.map((m, i) => {
      const r = m.matchedRecipient;
      const base: SplitEntry = {
        key: nextKey() + `_seed_${i}`,
        recipientType: r?.recipientType === "pix_external" ? "pix_external" : "asaas_wallet",
        recipientId: r?.id ?? null,
        walletId: r?.walletId ?? "",
        pixAddressKey: r?.pixAddressKey ?? "",
        pixKeyType: r?.pixKeyType ?? "",
        ownerName: r?.ownerName ?? m.comissionado.nome ?? "",
        ownerCpfCnpj:
          r?.ownerCpfCnpj ?? r?.cpfCnpj ?? m.comissionado.cpf ?? m.comissionado.cnpj ?? "",
        label: r?.label ?? m.comissionado.nome ?? "",
        percentualValue: m.comissionado.percentual ?? 0,
        sourceComissionado: m.comissionado,
      };
      return base;
    });
    if (seededLines.length > 0) onChange(seededLines);
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, seedFromComissionados, recipients]);

  function addLine() {
    onChange([
      ...value,
      {
        key: nextKey(),
        recipientType: "pix_external",
        recipientId: null,
        walletId: "",
        pixAddressKey: "",
        pixKeyType: "",
        ownerName: "",
        ownerCpfCnpj: "",
        label: "",
        percentualValue: 0,
      },
    ]);
  }

  function updateLine(key: string, patch: Partial<SplitEntry>) {
    onChange(value.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    onChange(value.filter((l) => l.key !== key));
  }

  function pickRecipient(key: string, recipientId: string) {
    const r = recipients.find((x) => x.id === recipientId);
    if (!r) return;
    updateLine(key, {
      recipientId: r.id,
      recipientType: r.recipientType,
      walletId: r.walletId ?? "",
      pixAddressKey: r.pixAddressKey ?? "",
      pixKeyType: r.pixKeyType ?? "",
      ownerName: r.ownerName ?? "",
      ownerCpfCnpj: r.ownerCpfCnpj ?? "",
      label: r.label,
    });
  }

  const sumCustom = value.reduce((s, l) => s + (l.percentualValue || 0), 0);
  const sumTotal = sumCustom + platformFeePercent;
  const remainderPct = Math.max(0, 100 - sumTotal);
  const overflow = sumTotal > 100;
  const externalCount = value.filter((v) => v.recipientType === "pix_external").length;
  const asaasNativeCount = value.filter((v) => v.recipientType === "asaas_wallet").length;
  const hiddenLines = useMemo(
    () => value.filter((l) => l.hiddenFromPayer),
    [value]
  );
  const visibleLines = useMemo(
    () => value.filter((l) => !l.hiddenFromPayer),
    [value]
  );

  function defaultConsolidationTarget(line: SplitEntry): string | undefined {
    if (visibleLines.length === 0) return undefined;
    const idx = value.findIndex((l) => l.key === line.key);
    // Próxima linha visível depois desta
    for (let i = idx + 1; i < value.length; i++) {
      if (!value[i].hiddenFromPayer) return value[i].key;
    }
    // Caiu no fim: pega a última visível anterior
    for (let i = idx - 1; i >= 0; i--) {
      if (!value[i].hiddenFromPayer) return value[i].key;
    }
    return undefined;
  }

  function toggleHide(key: string) {
    onChange(
      value.map((l) => {
        if (l.key !== key) return l;
        const newHidden = !l.hiddenFromPayer;
        return {
          ...l,
          hiddenFromPayer: newHidden,
          consolidateInto: newHidden ? l.consolidateInto ?? defaultConsolidationTarget(l) : undefined,
        };
      })
    );
  }

  return (
    <div className="space-y-3 border rounded-md p-3 bg-muted/30">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          O remanescente cai na subconta desta org automaticamente. Splits
          Asaas (wallet) são instantâneos e gratuitos. PIX externos disparam
          transferência automática após o pagamento (~R$ 1 de taxa por
          transferência).
        </div>
      </div>

      {value.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          Nenhum split ainda. Cadastre destinatários em{" "}
          <b>Configurações → Pagamentos → Destinatários de split</b> e adicione
          aqui.
        </p>
      )}

      {value.map((line) => {
        const noMatch =
          !line.recipientId &&
          line.walletId.trim() === "" &&
          line.pixAddressKey.trim() === "";
        const visibleTargets = visibleLines.filter((v) => v.key !== line.key);
        return (
          <div
            key={line.key}
            className={`border rounded p-2 ${
              line.hiddenFromPayer
                ? "bg-gray-100 border-gray-300"
                : noMatch && line.sourceComissionado
                  ? "bg-amber-50 border-amber-300"
                  : "bg-background"
            }`}
          >
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-7">
                <Label className="text-xs flex items-center gap-1">
                  Destinatário
                  {line.hiddenFromPayer && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1 bg-white">
                      Privado
                    </Badge>
                  )}
                </Label>
                {recipients.length > 0 ? (
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={line.recipientId ?? ""}
                    onChange={(e) => {
                      if (e.target.value === "") {
                        updateLine(line.key, {
                          recipientId: null,
                          walletId: "",
                          pixAddressKey: "",
                          pixKeyType: "",
                          ownerName: "",
                          ownerCpfCnpj: "",
                          label: "",
                        });
                      } else {
                        pickRecipient(line.key, e.target.value);
                      }
                    }}
                    disabled={disabled || loading}
                  >
                    <option value="">Selecione…</option>
                    {recipients.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.recipientType === "pix_external" ? "🔑 " : "💼 "}
                        {r.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Cadastre destinatários primeiro em Configurações.
                  </p>
                )}
                {line.recipientId && (
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    {line.recipientType === "pix_external" ? (
                      <KeyRound className="h-3 w-3" />
                    ) : (
                      <Wallet className="h-3 w-3" />
                    )}
                    {line.recipientType === "pix_external"
                      ? `PIX externo · ${line.ownerName}`
                      : `Conta Asaas`}
                  </div>
                )}
                {noMatch && line.sourceComissionado && (
                  <button
                    type="button"
                    onClick={() =>
                      setInlineDialog({
                        forKey: line.key,
                        prefill: line.sourceComissionado!,
                      })
                    }
                    className="mt-1 text-xs text-amber-900 underline hover:text-amber-700 flex items-center gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Cadastrar &ldquo;{line.sourceComissionado.nome}&rdquo; como
                    destinatário
                  </button>
                )}
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Percentual</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={line.percentualValue || ""}
                    onChange={(e) =>
                      updateLine(line.key, {
                        percentualValue: parseFloat(e.target.value) || 0,
                      })
                    }
                    disabled={disabled}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                {chargeValue > 0 && line.percentualValue > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtBRL((chargeValue * line.percentualValue) / 100)}
                    {line.recipientType === "pix_external" && (
                      <span className="text-amber-600">
                        {" "}
                        − ~{fmtBRL(PIX_FEE_ESTIMATE)} taxa
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="col-span-2 flex justify-end items-center gap-1">
                {enableHideFromPayer && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleHide(line.key)}
                    disabled={disabled}
                    title={
                      line.hiddenFromPayer
                        ? "Mostrar para o pagador"
                        : "Esconder do pagador (consolida valor)"
                    }
                  >
                    {line.hiddenFromPayer ? (
                      <EyeOff className="h-4 w-4 text-gray-700" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLine(line.key)}
                  disabled={disabled}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>

            {line.hiddenFromPayer && enableHideFromPayer && (
              <div className="mt-2 pl-2 border-l-2 border-gray-400">
                <Label className="text-xs text-gray-700">
                  Consolidar valor visualmente em
                </Label>
                {visibleTargets.length === 0 ? (
                  <p className="text-xs text-amber-700 italic mt-0.5">
                    Adicione pelo menos uma linha visível para consolidar.
                  </p>
                ) : (
                  <select
                    className="flex h-8 w-full rounded-md border border-input bg-white px-2 text-xs mt-0.5"
                    value={line.consolidateInto ?? defaultConsolidationTarget(line) ?? ""}
                    onChange={(e) =>
                      updateLine(line.key, { consolidateInto: e.target.value })
                    }
                    disabled={disabled}
                  >
                    {visibleTargets.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.label || v.ownerName || v.walletId || v.pixAddressKey || "(sem nome)"}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        );
      })}

      {value.length < 10 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLine}
          disabled={disabled || loading}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-1" /> Adicionar destinatário
        </Button>
      )}

      {platformFeePercent > 0 && (
        <div className="flex items-center justify-between text-xs bg-amber-50 border border-amber-200 rounded p-2">
          <span className="text-amber-900">Taxa de plataforma (automática)</span>
          <Badge variant="outline" className="text-xs">
            {platformFeePercent}%
          </Badge>
        </div>
      )}

      {externalCount > 0 && (
        <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 text-blue-900">
          {externalCount} destinatário(s) PIX externo: a transferência é disparada
          automaticamente após confirmação do pagamento. Se falhar (ex: saldo
          insuficiente), você pode tentar novamente no detalhe da cobrança.
        </div>
      )}

      <div className="flex items-center justify-between text-sm border-t pt-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            Soma dos splits: {sumTotal.toFixed(1)}% ·{" "}
            {overflow ? (
              <span className="text-red-600 font-medium">excede 100%</span>
            ) : (
              <>resta {remainderPct.toFixed(1)}% para esta org</>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {asaasNativeCount} Asaas-nativo(s) · {externalCount} PIX externo(s)
            {hiddenLines.length > 0 && ` · ${hiddenLines.length} privado(s)`}
          </div>
          {chargeValue > 0 && !overflow && (
            <div className="text-xs text-muted-foreground">
              Esta org recebe ~{fmtBRL((chargeValue * remainderPct) / 100)} (menos
              taxas Asaas e taxa PIX)
            </div>
          )}
        </div>
      </div>

      {inlineDialog && (
        <SplitRecipientInlineDialog
          open
          prefill={inlineDialog.prefill}
          onClose={() => setInlineDialog(null)}
          onCreated={async (created) => {
            await refreshRecipients();
            // Re-bind a linha origem ao recipient recém-criado
            onChange(
              value.map((l) =>
                l.key === inlineDialog.forKey
                  ? {
                      ...l,
                      recipientId: created.id,
                      recipientType: created.recipientType,
                      walletId: created.walletId ?? "",
                      pixAddressKey: created.pixAddressKey ?? "",
                      pixKeyType: created.pixKeyType ?? "",
                      ownerName: created.ownerName ?? l.ownerName,
                      ownerCpfCnpj: created.ownerCpfCnpj ?? created.cpfCnpj ?? l.ownerCpfCnpj,
                      label: created.label,
                    }
                  : l
              )
            );
            setInlineDialog(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Converte SplitEntry[] do editor em payload da API.
 * Remove entries vazias (sem recipient ou percentual 0).
 *
 * Retorna discriminated union — backend valida via Zod.
 */
export function toApiSplit(entries: SplitEntry[]): Array<
  | {
      recipientType: "asaas_wallet";
      recipientId?: string;
      walletId: string;
      label?: string;
      percentualValue: number;
    }
  | {
      recipientType: "pix_external";
      recipientId: string;
      pixAddressKey: string;
      pixKeyType: string;
      ownerName: string;
      ownerCpfCnpj: string;
      label?: string;
      percentualValue: number;
    }
> {
  return entries
    .filter((e) => e.percentualValue > 0)
    .filter((e) =>
      e.recipientType === "asaas_wallet"
        ? e.walletId.trim() !== ""
        : e.pixAddressKey.trim() !== "" && e.recipientId !== null
    )
    .map((e) => {
      if (e.recipientType === "asaas_wallet") {
        return {
          recipientType: "asaas_wallet" as const,
          recipientId: e.recipientId ?? undefined,
          walletId: e.walletId.trim(),
          label: e.label || undefined,
          percentualValue: e.percentualValue,
        };
      }
      return {
        recipientType: "pix_external" as const,
        recipientId: e.recipientId!,
        pixAddressKey: e.pixAddressKey.trim(),
        pixKeyType: e.pixKeyType,
        ownerName: e.ownerName,
        ownerCpfCnpj: e.ownerCpfCnpj,
        label: e.label || undefined,
        percentualValue: e.percentualValue,
      };
    });
}

/**
 * Computa o `display` block (hiddenRecipientIds + consolidationMap) a partir
 * das linhas do editor. ID de cada linha é o `recipientId` quando existe;
 * fallback para walletId/pixAddressKey.
 */
export function toApiDisplay(entries: SplitEntry[]): {
  hiddenRecipientIds: string[];
  consolidationMap: Record<string, string>;
} {
  function lineId(e: SplitEntry): string {
    return (
      e.recipientId ??
      (e.recipientType === "asaas_wallet" ? e.walletId : e.pixAddressKey)
    );
  }
  const hiddenRecipientIds: string[] = [];
  const consolidationMap: Record<string, string> = {};
  const keyToId = new Map<string, string>();
  for (const e of entries) keyToId.set(e.key, lineId(e));

  for (const e of entries) {
    if (!e.hiddenFromPayer) continue;
    const id = lineId(e);
    if (!id) continue;
    hiddenRecipientIds.push(id);
    if (e.consolidateInto) {
      const targetId = keyToId.get(e.consolidateInto);
      if (targetId) consolidationMap[id] = targetId;
    }
  }
  return { hiddenRecipientIds, consolidationMap };
}
