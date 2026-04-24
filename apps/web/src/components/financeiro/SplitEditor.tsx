"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Info } from "lucide-react";

export interface SplitEntry {
  /** ID local para tracking no form. Não enviado ao Asaas. */
  key: string;
  /** ID do SplitRecipient (null quando é manual/freeform). */
  recipientId: string | null;
  walletId: string;
  label: string;
  percentualValue: number;
}

interface Recipient {
  id: string;
  label: string;
  walletId: string;
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
        recipientId: null,
        walletId: "",
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
      walletId: r.walletId,
      label: r.label,
    });
  }

  const sumCustom = value.reduce((s, l) => s + (l.percentualValue || 0), 0);
  const sumTotal = sumCustom + platformFeePercent;
  const remainderPct = Math.max(0, 100 - sumTotal);
  const overflow = sumTotal > 100;

  return (
    <div className="space-y-3 border rounded-md p-3 bg-muted/30">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          O remanescente (após subtrair todos os splits) cai na subconta desta
          organização automaticamente — não precisa listar a sua própria.
          Máximo de 10 destinatários.
        </div>
      </div>

      {value.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          Nenhum split ainda. Clique em <b>Adicionar destinatário</b>.
        </p>
      )}

      {value.map((line) => (
        <div
          key={line.key}
          className="grid grid-cols-12 gap-2 items-end border rounded p-2 bg-background"
        >
          <div className="col-span-6">
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
                    {r.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                placeholder="Wallet ID Asaas"
                value={line.walletId}
                onChange={(e) =>
                  updateLine(line.key, {
                    walletId: e.target.value,
                    label: line.label || e.target.value.slice(0, 8),
                  })
                }
                disabled={disabled}
              />
            )}
          </div>
          <div className="col-span-4">
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
          <span className="text-amber-900">
            Taxa de plataforma (automática)
          </span>
          <Badge variant="outline" className="text-xs">
            {platformFeePercent}%
          </Badge>
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
          {chargeValue > 0 && !overflow && (
            <div className="text-xs text-muted-foreground">
              Esta org recebe ~{fmtBRL((chargeValue * remainderPct) / 100)} (menos
              taxas Asaas)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Converte SplitEntry[] do editor em AsaasSplit[] para enviar ao backend.
 * Remove entries vazias (walletId falso ou percentual 0).
 */
export function toApiSplit(
  entries: SplitEntry[]
): { walletId: string; percentualValue: number }[] {
  return entries
    .filter((e) => e.walletId.trim() !== "" && e.percentualValue > 0)
    .map((e) => ({
      walletId: e.walletId.trim(),
      percentualValue: e.percentualValue,
    }));
}
