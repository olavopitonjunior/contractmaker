"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/forms/NativeSelect";
import {
  DEFAULT_CONTRACT_SETTINGS,
  type ContractSettings,
} from "@/lib/contracts/default-config";

/**
 * Padrão de configurações contratuais da imobiliária.
 *
 * Vale para contratos NOVOS: a geração aplica este padrão onde o negócio não
 * definiu nada. Contrato já criado se ajusta na aba "Configurações" do editor.
 *
 * Local/data de assinatura não entram aqui de propósito — são por negócio (a
 * data é a da assinatura; a cidade sai do imóvel).
 */
export function ContractDefaultsCard({ initial }: { initial: ContractSettings }) {
  const [values, setValues] = useState<ContractSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function patch(next: Partial<ContractSettings>) {
    setValues((v) => ({ ...v, ...next }));
    setDirty(true);
  }
  function patchConfig(next: Partial<ContractSettings["config"]>) {
    setValues((v) => ({ ...v, config: { ...v.config, ...next } }));
    setDirty(true);
  }
  const num = (raw: string, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/org/form-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractDefaults: { venda: values } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Não foi possível salvar o padrão.");
        return;
      }
      toast.success("Padrão salvo — vale para os próximos contratos.");
      setDirty(false);
    } catch {
      toast.error("Erro de rede ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Padrão contratual (venda)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Condições aplicadas aos contratos novos desta imobiliária. Cada
          contrato pode sobrescrevê-las na aba <strong>Configurações</strong> do
          editor.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Foro de resolução de disputas
            </Label>
            <NativeSelect
              value={values.foro}
              onChange={(v) => patch({ foro: v as ContractSettings["foro"] })}
              options={[
                { value: "arbitragem", label: "Arbitragem" },
                { value: "justica-publica", label: "Justiça Comum" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Cláusula de desistência
            </Label>
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="org-desistencia"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={values.desistencia.permite}
                onChange={(e) =>
                  patch({
                    desistencia: { ...values.desistencia, permite: e.target.checked },
                  })
                }
              />
              <Label htmlFor="org-desistencia" className="text-sm font-normal">
                Permitir por padrão
              </Label>
              {values.desistencia.permite && (
                <Input
                  type="number"
                  min={1}
                  className="ml-2 h-8 w-20"
                  value={values.desistencia.prazo_dias}
                  onChange={(e) =>
                    patch({
                      desistencia: {
                        ...values.desistencia,
                        prazo_dias: num(e.target.value, 7),
                      },
                    })
                  }
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Multa moratória (%)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={values.config.multa_penal_moratoria}
              onChange={(e) =>
                patchConfig({ multa_penal_moratoria: num(e.target.value, 2) })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Juros por atraso (% ao mês)
            </Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={values.config.juros_mensais_atraso}
              onChange={(e) =>
                patchConfig({ juros_mensais_atraso: num(e.target.value, 1) })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Multa compensatória (%)
            </Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={values.config.multa_penal_compensatoria}
              onChange={(e) =>
                patchConfig({ multa_penal_compensatoria: num(e.target.value, 5) })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Atualização monetária
            </Label>
            <Input
              value={values.config.atualizacao_monetaria}
              onChange={(e) =>
                patchConfig({ atualizacao_monetaria: e.target.value })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Base de cálculo da multa
            </Label>
            <Input
              value={values.config.base_calculo_multa}
              onChange={(e) => patchConfig({ base_calculo_multa: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Multa diária por atraso (R$)
            </Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={values.config.multa_cominatoria_diaria}
              onChange={(e) =>
                patchConfig({ multa_cominatoria_diaria: num(e.target.value, 500) })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Prazo p/ purgação da mora (dias)
            </Label>
            <Input
              type="number"
              min={1}
              value={values.config.prazo_atraso_rescisao}
              onChange={(e) =>
                patchConfig({ prazo_atraso_rescisao: num(e.target.value, 15) })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">
              Prazo p/ devolução na rescisão (dias)
            </Label>
            <Input
              type="number"
              min={1}
              value={values.config.prazo_multa_rescisoria}
              onChange={(e) =>
                patchConfig({ prazo_multa_rescisoria: num(e.target.value, 30) })
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-4 w-4" />
                Salvar padrão
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setValues(DEFAULT_CONTRACT_SETTINGS);
              setDirty(true);
            }}
            disabled={saving}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Restaurar sugerido
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
