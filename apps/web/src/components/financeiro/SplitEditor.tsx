"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Info, Wallet, KeyRound } from "lucide-react";

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
}: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/financeiro/split-recipients", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setRecipients(
            (data.recipients ?? []).filter((r: Recipient) => r.active)
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

      {value.map((line) => (
        <div
          key={line.key}
          className="grid grid-cols-12 gap-2 items-end border rounded p-2 bg-background"
        >
          <div className="col-span-7">
            <Label className="text-xs">Destinatário</Label>
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
          <div className="col-span-2 flex justify-end">
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
      ))}

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
          </div>
          {chargeValue > 0 && !overflow && (
            <div className="text-xs text-muted-foreground">
              Esta org recebe ~{fmtBRL((chargeValue * remainderPct) / 100)} (menos
              taxas Asaas e taxa PIX)
            </div>
          )}
        </div>
      </div>
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
