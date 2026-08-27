"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { UF_LIST } from "@/components/forms/UFSelect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEFAULT_CONTRACT_SETTINGS,
  DEFAULT_LOCACAO_COMISSAO,
  DEFAULT_LOCACAO_SETTINGS,
  type ContractSettings,
  type LocacaoComissaoDefaults,
  type LocacaoSettings,
} from "@/lib/contracts/default-config";

/**
 * Padrão de configurações contratuais da imobiliária.
 *
 * Vale para contratos NOVOS: a geração aplica este padrão onde o negócio não
 * definiu nada. Contrato já criado se ajusta na aba "Configurações" do editor.
 *
 * Uma aba por esteira: os vocabulários não se traduzem (em venda `foro` é um
 * enum que troca a cláusula inteira; em locação é a comarca em texto, e a multa
 * rescisória é contada em meses de aluguel). A aba Locação só aparece pra org
 * que tem o módulo — o gating vem do server component.
 *
 * Local de assinatura: em VENDA continua fora (o formulário público ainda
 * pergunta). Em LOCAÇÃO entrou em 2026-07-30 — a etapa de Confirmação saiu do
 * formulário do cliente, então cidade/UF passaram a ser decisão da imobiliária
 * (a praça de fechamento é sempre a mesma). A DATA continua fora nas duas: é
 * por negócio, e vazia o template usa a data da assinatura.
 */
export function ContractDefaultsCard({
  initial,
  initialLocacao,
  initialComissaoLocacao,
  locacaoEnabled = false,
}: {
  initial: ContractSettings;
  initialLocacao: LocacaoSettings;
  initialComissaoLocacao: LocacaoComissaoDefaults;
  locacaoEnabled?: boolean;
}) {
  if (!locacaoEnabled) return <VendaDefaults initial={initial} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Padrão contratual</CardTitle>
        <p className="text-sm text-muted-foreground">
          Condições aplicadas aos contratos novos desta imobiliária. Cada
          contrato pode sobrescrevê-las na aba <strong>Configurações</strong> do
          editor.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="venda">
          <TabsList>
            <TabsTrigger value="venda">Vendas</TabsTrigger>
            <TabsTrigger value="locacao">Locação</TabsTrigger>
          </TabsList>
          <TabsContent value="venda" className="mt-4">
            <VendaDefaults initial={initial} embedded />
          </TabsContent>
          <TabsContent value="locacao" className="mt-4">
            <LocacaoDefaults
              initial={initialLocacao}
              initialComissao={initialComissaoLocacao}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function VendaDefaults({
  initial,
  embedded = false,
}: {
  initial: ContractSettings;
  embedded?: boolean;
}) {
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

  const body = (
    <div className="space-y-4">
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
    </div>
  );

  if (embedded) return body;

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
      <CardContent>{body}</CardContent>
    </Card>
  );
}

/**
 * Padrão de locação. Vocabulário próprio (ver `locacaoSettingsSchema`): a
 * comarca é texto livre e a multa rescisória é contada em MESES de aluguel.
 */
function LocacaoDefaults({
  initial,
  initialComissao,
}: {
  initial: LocacaoSettings;
  initialComissao: LocacaoComissaoDefaults;
}) {
  const [values, setValues] = useState<LocacaoSettings>(initial);
  const [comissao, setComissao] =
    useState<LocacaoComissaoDefaults>(initialComissao);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function patchComissao(next: Partial<LocacaoComissaoDefaults>) {
    setComissao((c) => ({ ...c, ...next }));
    setDirty(true);
  }

  function patchConfig(next: Partial<LocacaoSettings["config"]>) {
    setValues((v) => ({ ...v, config: { ...v.config, ...next } }));
    setDirty(true);
  }
  function patchAssinatura(next: Partial<LocacaoSettings["assinatura"]>) {
    setValues((v) => ({ ...v, assinatura: { ...v.assinatura, ...next } }));
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
        // Só o branch de locação: o PATCH mescla por branch, então o padrão de
        // venda não é tocado.
        body: JSON.stringify({
          contractDefaults: { locacao: values, locacao_comissao: comissao },
        }),
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-sm text-muted-foreground">Foro (comarca)</Label>
          <Input
            value={values.foro}
            placeholder="Ex.: São Paulo/SP"
            onChange={(e) => {
              setValues((v) => ({ ...v, foro: e.target.value }));
              setDirty(true);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Em branco, o contrato usa a comarca de localização do imóvel.
          </p>
        </div>

        {/* Praça de assinatura — entrou quando a etapa de Confirmação saiu do
            formulário público de locação. Vazio mantém o comportamento
            anterior: o contrato usa a cidade/UF do imóvel. */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-sm text-muted-foreground">
            Cidade da assinatura
          </Label>
          <Input
            value={values.assinatura.cidade}
            placeholder="Ex.: São Paulo"
            onChange={(e) => patchAssinatura({ cidade: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Em branco, o contrato usa a cidade do imóvel.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-sm text-muted-foreground">
            UF da assinatura
          </Label>
          <NativeSelect
            value={values.assinatura.uf}
            onChange={(v) => patchAssinatura({ uf: v })}
            options={[
              { value: "", label: "Usar a UF do imóvel" },
              ...UF_LIST.map((uf) => ({ value: uf, label: uf })),
            ]}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-sm text-muted-foreground">
            Multa por atraso (%)
          </Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={values.config.multa_atraso_percent}
            onChange={(e) =>
              patchConfig({ multa_atraso_percent: num(e.target.value, 10) })
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

        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-sm text-muted-foreground">
            Multa rescisória (meses de aluguel)
          </Label>
          <Input
            type="number"
            step="0.5"
            min={0}
            value={values.config.multa_rescisoria_meses}
            onChange={(e) =>
              patchConfig({ multa_rescisoria_meses: num(e.target.value, 3) })
            }
          />
        </div>

        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-sm text-muted-foreground">
            Honorários advocatícios (%)
          </Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={values.config.honorarios_advocaticios_percent}
            onChange={(e) =>
              patchConfig({
                honorarios_advocaticios_percent: num(e.target.value, 10),
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            Percentual sobre o débito na cobrança judicial ou extrajudicial.
          </p>
        </div>
      </div>

      {/* Comissão de intermediação. Fica aqui e não no formulário do cliente
          porque é decisão comercial da imobiliária — o operador redigitava o
          mesmo número a cada formulário novo. Preenchido, vira o valor inicial
          da etapa Comissão; quem monta o negócio ainda pode mudar caso a caso. */}
      <div className="space-y-4 rounded-md border border-border p-4">
        <div>
          <h4 className="text-sm font-medium">
            Comissão de intermediação (1º aluguel)
          </h4>
          <p className="text-xs text-muted-foreground">
            Padrão sugerido ao criar um formulário de locação. Zero = sem
            sugestão (o campo nasce em branco, como antes).
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Cobrada como</Label>
            <NativeSelect
              value={comissao.forma}
              onChange={(v) =>
                patchComissao({ forma: v === "valor_fixo" ? "valor_fixo" : "percentual" })
              }
              options={[
                { value: "percentual", label: "% do primeiro aluguel" },
                { value: "valor_fixo", label: "Valor fixo (R$)" },
              ]}
            />
          </div>
          {comissao.forma === "valor_fixo" ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-muted-foreground">
                Valor fixo (R$)
              </Label>
              <MoneyInput
                value={comissao.taxa_locacao_valor}
                onChange={(v) => patchComissao({ taxa_locacao_valor: v })}
                placeholder="Ex: 800,00"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm text-muted-foreground">
                Percentual (%)
              </Label>
              <Input
                type="number"
                step="0.5"
                min={0}
                max={100}
                value={comissao.taxa_locacao_percent}
                onChange={(e) =>
                  patchComissao({
                    taxa_locacao_percent: num(e.target.value, 0),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                100% = um aluguel inteiro, o mais comum no mercado.
              </p>
            </div>
          )}
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
            setValues(DEFAULT_LOCACAO_SETTINGS);
            setComissao(DEFAULT_LOCACAO_COMISSAO);
            setDirty(true);
          }}
          disabled={saving}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Restaurar sugerido
        </Button>
      </div>
    </div>
  );
}
