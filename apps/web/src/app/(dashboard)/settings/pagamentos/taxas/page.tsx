"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  previewCharge,
  type FeesSettings,
  type DiscountPreset,
  DEFAULT_FEES_SETTINGS,
} from "@/lib/financeiro/fees";
import { Plus, Trash2, Save } from "lucide-react";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function TaxasPage() {
  const [settings, setSettings] = useState<FeesSettings>(DEFAULT_FEES_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewBase, setPreviewBase] = useState(1000);
  const [previewPix, setPreviewPix] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/financeiro/settings", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setSettings({ ...DEFAULT_FEES_SETTINGS, ...data.settings });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update<K extends keyof FeesSettings>(key: K, value: FeesSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty(true);
  }

  function addDiscountPreset() {
    const np: DiscountPreset = {
      id: `preset_${Date.now()}`,
      label: "Novo desconto",
      type: "PERCENTAGE",
      value: 5,
      dueDayOffset: -3,
    };
    update("discountPresets", [...settings.discountPresets, np]);
  }

  function updateDiscountPreset(id: string, patch: Partial<DiscountPreset>) {
    update(
      "discountPresets",
      settings.discountPresets.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  }

  function removeDiscountPreset(id: string) {
    update(
      "discountPresets",
      settings.discountPresets.filter((p) => p.id !== id)
    );
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/financeiro/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.message ?? data.error ?? "Falha ao salvar");
        return;
      }
      toast.success("Configurações salvas");
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  const preview = previewCharge({
    nominalValue: previewBase,
    billingType: previewPix ? "PIX" : "BOLETO",
    settings,
    dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    discountPresetId: settings.discountPresets[0]?.id,
  });

  const fineError =
    settings.finePercent > 2
      ? `${settings.finePercent}% excede o limite legal de 2% (CDC art. 52)`
      : null;
  const interestError =
    settings.interestPercentMonth > 1
      ? `${settings.interestPercentMonth}%/mês excede o limite legal de 1%/mês (CDC art. 52)`
      : null;
  const hasValidationErrors = !!(fineError || interestError);

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Taxas e descontos</h1>
          <p className="text-sm text-muted-foreground">
            Configure platform fee, overprice, descontos, multa e juros.
          </p>
        </div>
        <Button
          onClick={save}
          disabled={saving || !dirty || hasValidationErrors}
          title={hasValidationErrors ? "Corrija os erros antes de salvar" : undefined}
        >
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Controls */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Taxa de repasse (plataforma)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="pf">Percentual para a plataforma</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="pf"
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={settings.platformFeePercent}
                    onChange={(e) =>
                      update("platformFeePercent", parseFloat(e.target.value) || 0)
                    }
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  0 a 10%. Split só é gerado se wallet ID abaixo também estiver configurado.
                </p>
              </div>
              <div>
                <Label htmlFor="pfw">Wallet ID de destino (plataforma)</Label>
                <Input
                  id="pfw"
                  type="text"
                  placeholder="Ex: 80cd2f34-7a1b-4c85-9d12-abc1234def56"
                  value={settings.platformFeeWalletId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    update("platformFeeWalletId", v === "" ? null : v);
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  walletId da conta master Asaas que vai receber o repasse. Obrigatório
                  para o split automático acontecer.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cobertura de taxa Asaas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {(["none", "asaas_fee", "custom"] as const).map((p) => (
                  <label
                    key={p}
                    className={`flex items-center gap-2 border rounded p-2 cursor-pointer ${
                      settings.overpricePolicy === p ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      checked={settings.overpricePolicy === p}
                      onChange={() => update("overpricePolicy", p)}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {p === "none" && "Absorver — eu pago a taxa Asaas"}
                        {p === "asaas_fee" && "Acrescer valor da taxa Asaas ao cobrado"}
                        {p === "custom" && "Personalizado"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p === "none" &&
                          "Pagador paga exatamente o valor nominal. Taxa sai do meu bolso."}
                        {p === "asaas_fee" &&
                          "Pagador paga nominal + R$ 1,99 (PIX) ou R$ 3,49 (boleto)."}
                        {p === "custom" && "Defina percentual ou valor fixo abaixo."}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              {settings.overpricePolicy === "custom" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <Label>Tipo</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={settings.overpriceType ?? "percentage"}
                      onChange={(e) => update("overpriceType", e.target.value as any)}
                    >
                      <option value="percentage">Percentual</option>
                      <option value="fixed">Valor fixo (R$)</option>
                    </select>
                  </div>
                  <div>
                    <Label>Valor</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={settings.overpriceValue ?? 0}
                      onChange={(e) =>
                        update("overpriceValue", parseFloat(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>
              )}
              <div>
                <Label>Arredondamento</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={settings.overpriceRoundTo}
                  onChange={(e) => update("overpriceRoundTo", e.target.value as any)}
                >
                  <option value="cents">Centavos exatos</option>
                  <option value="real_up">Real p/ cima</option>
                  <option value="real_down">Real p/ baixo</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Splits PIX externos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {(["org_absorbs", "deduct_from_recipient"] as const).map((p) => (
                  <label
                    key={p}
                    className={`flex items-center gap-2 border rounded p-2 cursor-pointer ${
                      settings.pixSplitFeePolicy === p ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      checked={settings.pixSplitFeePolicy === p}
                      onChange={() => update("pixSplitFeePolicy", p)}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {p === "org_absorbs" && "Org absorve a taxa"}
                        {p === "deduct_from_recipient" && "Descontar do split do beneficiário"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p === "org_absorbs" &&
                          "Beneficiário recebe valor cheio. Taxa Asaas (~R$ 1) sai da sua conta a cada transferência PIX externa."}
                        {p === "deduct_from_recipient" &&
                          "A taxa é descontada da fatia do beneficiário. Pode causar valores quebrados se o split for muito pequeno."}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Aplica-se a destinatários PIX externos (sem conta Asaas). Splits
                Asaas-nativos (via walletId) não têm taxa.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Multa e juros</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="fine">Multa por atraso</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="fine"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={settings.finePercent}
                    onChange={(e) =>
                      update("finePercent", parseFloat(e.target.value) || 0)
                    }
                    aria-invalid={!!fineError}
                    className={fineError ? "border-red-500 focus-visible:ring-red-500" : ""}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                {fineError ? (
                  <p className="text-xs text-red-600 mt-1">{fineError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    Máximo legal CDC: 2%
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="interest">Juros ao mês</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="interest"
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={settings.interestPercentMonth}
                    onChange={(e) =>
                      update("interestPercentMonth", parseFloat(e.target.value) || 0)
                    }
                    aria-invalid={!!interestError}
                    className={interestError ? "border-red-500 focus-visible:ring-red-500" : ""}
                  />
                  <span className="text-sm text-muted-foreground">%/mês</span>
                </div>
                {interestError ? (
                  <p className="text-xs text-red-600 mt-1">{interestError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    Máximo legal CDC: 1% ao mês
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                Presets de desconto
                <Button variant="outline" size="sm" onClick={addDiscountPreset}>
                  <Plus className="h-3 w-3 mr-1" /> Novo
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {settings.discountPresets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum preset. Adicione para oferecer desconto por pagamento antecipado.
                </p>
              )}
              {settings.discountPresets.map((p) => (
                <div key={p.id} className="border rounded p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={p.label}
                      onChange={(e) =>
                        updateDiscountPreset(p.id, { label: e.target.value })
                      }
                      placeholder="Ex: Pagamento antecipado"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeDiscountPreset(p.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      className="h-9 rounded border border-input bg-background px-2 text-sm"
                      value={p.type}
                      onChange={(e) =>
                        updateDiscountPreset(p.id, { type: e.target.value as any })
                      }
                    >
                      <option value="PERCENTAGE">%</option>
                      <option value="FIXED">R$</option>
                    </select>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={p.value}
                      onChange={(e) =>
                        updateDiscountPreset(p.id, {
                          value: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                    <Input
                      type="number"
                      step="1"
                      max="0"
                      value={p.dueDayOffset}
                      onChange={(e) =>
                        updateDiscountPreset(p.id, {
                          dueDayOffset: parseInt(e.target.value) || 0,
                        })
                      }
                      placeholder="dias antes"
                      title="Dias antes do vencimento (negativo)"
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        <div className="space-y-4">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Valor exemplo (R$)</Label>
                  <Input
                    type="number"
                    value={previewBase}
                    onChange={(e) => setPreviewBase(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Método</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={previewPix ? "pix" : "boleto"}
                    onChange={(e) => setPreviewPix(e.target.value === "pix")}
                  >
                    <option value="pix">PIX</option>
                    <option value="boleto">Boleto</option>
                  </select>
                </div>
              </div>

              <hr />

              <div className="space-y-1 text-sm">
                <Row label="Valor nominal" value={fmtBRL(preview.nominalValue)} />
                <Row
                  label="Overprice"
                  value={`+ ${fmtBRL(preview.overpriceAmount)}`}
                  muted={preview.overpriceAmount === 0}
                />
                <Row
                  label="Cobrado do pagador"
                  value={fmtBRL(preview.grossValue)}
                  bold
                />
                <Row
                  label="Taxa Asaas estimada"
                  value={`− ${fmtBRL(preview.asaasFeeEstimate)}`}
                  muted
                />
                <Row
                  label="Líquido recebido"
                  value={fmtBRL(preview.netValueEstimate)}
                />
                {preview.platformFeeAmount > 0 && (
                  <Row
                    label="Platform fee"
                    value={`− ${fmtBRL(preview.platformFeeAmount)}`}
                    muted
                  />
                )}
                <Row
                  label="Sua organização recebe"
                  value={fmtBRL(preview.orgReceives)}
                  bold
                  accent="green"
                />
              </div>

              {preview.discount && (
                <>
                  <hr />
                  <div className="bg-green-50 border border-green-200 p-3 rounded text-sm space-y-1">
                    <div className="font-medium text-green-900">
                      Com desconto: {preview.discount.label}
                    </div>
                    <div className="text-xs text-green-800">
                      − {fmtBRL(preview.discount.amount)} se pagar até{" "}
                      {preview.discount.validUntil.toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                </>
              )}

              <hr />

              <div className="text-xs space-y-1 text-muted-foreground">
                <div>Se pagar atrasado:</div>
                <div>
                  + Multa {settings.finePercent}% = {fmtBRL(preview.fineAmount)}
                </div>
                <div>
                  + Juros {settings.interestPercentMonth}%/mês ={" "}
                  {fmtBRL(preview.interestPerDay)}/dia pro-rata
                </div>
              </div>

              {dirty && (
                <Badge variant="outline" className="text-amber-700 border-amber-300">
                  Alterações não salvas
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  accent?: "green" | "red";
}) {
  return (
    <div
      className={`flex justify-between ${muted ? "text-muted-foreground text-xs" : ""} ${
        bold ? "font-semibold" : ""
      } ${accent === "green" ? "text-green-700" : ""}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
