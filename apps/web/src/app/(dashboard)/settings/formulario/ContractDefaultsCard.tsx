"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { RotateCcw } from "lucide-react";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";
import {
  useSettingsAutoSave,
  type SettingsFields,
} from "@/hooks/use-settings-auto-save";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { UF_LIST } from "@/components/forms/UFSelect";
import {
  DEFAULT_CONTRACT_SETTINGS,
  DEFAULT_LOCACAO_COMISSAO,
  DEFAULT_LOCACAO_RECEBIMENTO,
  DEFAULT_LOCACAO_SETTINGS,
  type ContractSettings,
  type LocacaoComissaoDefaults,
  type LocacaoRecebimento,
  type LocacaoSettings,
} from "@/lib/contracts/default-config";
import { useEsteira } from "./EsteiraTabs";

/**
 * Padrão de configurações contratuais da imobiliária.
 *
 * Vale para contratos NOVOS: a geração aplica este padrão onde o negócio não
 * definiu nada. Contrato já criado se ajusta na aba "Configurações" do editor.
 *
 * Uma esteira por vez: os vocabulários não se traduzem (em venda `foro` é um
 * enum que troca a cláusula inteira; em locação é a comarca em texto, e a multa
 * rescisória é contada em meses de aluguel). Locação só aparece pra org que tem
 * o módulo — o gating vem do server component.
 *
 * Quem escolhe a esteira é o seletor ÚNICO da página (`EsteiraTabs`). Este card
 * tinha `Tabs` próprias, e uma página com dois seletores discordando entre si
 * foi o que fez o catálogo de seguradoras aparecer com "Vendas" selecionado.
 *
 * Local de assinatura: em VENDA continua fora (o formulário público ainda
 * pergunta). Em LOCAÇÃO entrou em 2026-07-30 — a etapa de Confirmação saiu do
 * formulário do cliente, então cidade/UF passaram a ser decisão da imobiliária
 * (a praça de fechamento é sempre a mesma). A DATA continua fora nas duas: é
 * por negócio, e vazia o template usa a data da assinatura.
 */
/** Par do `useState`, para o pai poder ceder o estado ao filho inteiro. */
type SettingsState<T> = [T, Dispatch<SetStateAction<T>>];

/** O que o filho precisa do auto-save do pai: só status e sujeira, pra pill. */
type AutoSave = ReturnType<typeof useSettingsAutoSave<SettingsFields>>;

export function ContractDefaultsCard({
  initial,
  initialLocacao,
  initialComissaoLocacao,
  initialRecebimentoLocacao,
  locacaoEnabled = false,
}: {
  initial: ContractSettings;
  initialLocacao: LocacaoSettings;
  initialComissaoLocacao: LocacaoComissaoDefaults;
  initialRecebimentoLocacao: LocacaoRecebimento;
  locacaoEnabled?: boolean;
}) {
  const esteira = useEsteira();

  // O estado das duas esteiras E o auto-save de cada uma vivem AQUI, não
  // dentro de cada formulário. Trocar de esteira DESMONTA o filho (é render
  // condicional, logo abaixo), e isso quebrava de duas formas:
  //
  // 1. `useState(initial)` no filho ressemeava do snapshot que a RSC leu no
  //    carregamento da PÁGINA. Depois de um save bem-sucedido, o campo voltava
  //    a mostrar o valor PRÉ-edição com o servidor já correto.
  //
  // 2. Com o estado aqui mas o HOOK ainda no filho, sobrava um buraco pior:
  //    o flush no unmount podia FALHAR (rede, 5xx) e ninguém saberia. O `catch`
  //    do hook só publica erro `if (mountedRef.current)`, e nesse instante o
  //    componente já morreu — nem status, nem toast. Ao remontar, o hook novo
  //    semeia `baselineRef` a partir dos `fields` ATUAIS, que já são o valor
  //    editado: `dirtyKeys` nasce vazio, a pill diz "limpo" e o servidor segue
  //    no valor velho. Perda SILENCIOSA — pior que o bug 1, que ao menos era
  //    visível no campo.
  //
  // Com o hook aqui, o baseline e o `pendingRef` sobrevivem à troca de esteira:
  // o debounce simplesmente continua e grava. Não há unmount, então o flush de
  // unmount nem entra em cena — ele volta a ser só o que sempre deveria ter
  // sido, a rede de segurança de quem SAI da página. E uma falha deixa a chave
  // suja, então a pill mostra "Alterações não salvas" em vez de mentir.
  const vendaState = useState<ContractSettings>(initial);
  const locacaoState = useState<LocacaoSettings>(initialLocacao);
  const comissaoState =
    useState<LocacaoComissaoDefaults>(initialComissaoLocacao);
  const recebimentoState = useState<LocacaoRecebimento>(initialRecebimentoLocacao);

  // O branch inteiro é a unidade de salvamento, não o campo: `desistencia.
  // prazo_dias` só faz sentido junto com `desistencia.permite`, e a rota mescla
  // por branch — mandar `venda` não toca no padrão de locação.
  const vendaAutoSave = useSettingsAutoSave(
    { contractDefaults: { venda: vendaState[0] } },
    {
      endpoint: "/api/org/form-settings",
      // Espelha os `min(1).max(365)` de `contractSettingsSchema`: enquanto um
      // prazo estiver fora de faixa, a seção fica pendente em vez de mandar um
      // corpo que a rota recusaria.
      isValid: () => diasNaFaixa(vendaState[0]),
    },
  );
  // Só os branches de locação: o PATCH mescla por branch, então o padrão de
  // venda não é tocado. `enabled` desliga o agendamento para org sem o módulo —
  // o hook precisa ser chamado incondicionalmente (regra dos hooks), mas não
  // pode agendar PATCH de uma esteira que a org nem tem.
  const locacaoAutoSave = useSettingsAutoSave(
    {
      contractDefaults: {
        locacao: locacaoState[0],
        locacao_comissao: comissaoState[0],
        locacao_recebimento: recebimentoState[0],
      },
    },
    {
      endpoint: "/api/org/form-settings",
      // Espelha as faixas de `locacaoSettingsSchema`,
      // `locacaoComissaoDefaultsSchema` e `locacaoRecebimentoSchema`: percentual
      // digitado grande demais (999 a caminho de 99) ou chave PIX além do
      // limite não podem virar PATCH recusado.
      isValid: () =>
        locacaoNaFaixa(locacaoState[0], comissaoState[0]) &&
        recebimentoNaFaixa(recebimentoState[0]),
      enabled: locacaoEnabled,
    },
  );

  if (!locacaoEnabled)
    return <VendaDefaults state={vendaState} autoSave={vendaAutoSave} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Padrão contratual · {esteira === "venda" ? "Vendas" : "Locação"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Condições aplicadas aos contratos novos desta imobiliária. Cada
          contrato pode sobrescrevê-las na aba <strong>Configurações</strong> do
          editor.
        </p>
      </CardHeader>
      <CardContent>
        {esteira === "venda" ? (
          <VendaDefaults
            state={vendaState}
            autoSave={vendaAutoSave}
            embedded
          />
        ) : (
          <LocacaoDefaults
            state={locacaoState}
            comissaoState={comissaoState}
            recebimentoState={recebimentoState}
            autoSave={locacaoAutoSave}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Faixa aceita pelo schema para todo prazo em dias (`min(1).max(365)`). */
function diaValido(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 365;
}

function diasNaFaixa(v: ContractSettings): boolean {
  return (
    diaValido(v.desistencia.prazo_dias) &&
    diaValido(v.config.prazo_atraso_rescisao) &&
    diaValido(v.config.prazo_multa_rescisoria)
  );
}

function VendaDefaults({
  state,
  autoSave,
  embedded = false,
}: {
  state: SettingsState<ContractSettings>;
  autoSave: AutoSave;
  embedded?: boolean;
}) {
  const [values, setValues] = state;

  function patch(next: Partial<ContractSettings>) {
    setValues((v) => ({ ...v, ...next }));
  }
  function patchConfig(next: Partial<ContractSettings["config"]>) {
    setValues((v) => ({ ...v, config: { ...v.config, ...next } }));
  }
  const num = (raw: string, fallback: number) => {
    // `Number("")` é 0, e 0 é finito — sem este guard, apagar o campo para
    // digitar outro valor gravava 0, que viola o `min(1)` do schema. Com
    // auto-save isso vira PATCH 400 no meio da digitação; campo vazio é
    // "ainda não digitou", não zero.
    if (raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

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

      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setValues(DEFAULT_CONTRACT_SETTINGS)}
          disabled={autoSave.status === "saving"}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Restaurar sugerido
        </Button>
        <SaveStatusPill status={autoSave.status} isDirty={autoSave.isDirty} />
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
function naFaixa(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

function locacaoNaFaixa(
  v: LocacaoSettings,
  c: LocacaoComissaoDefaults,
): boolean {
  return (
    naFaixa(v.config.multa_atraso_percent, 0, 100) &&
    naFaixa(v.config.juros_mensais_atraso, 0, 100) &&
    naFaixa(v.config.multa_rescisoria_meses, 0, 120) &&
    naFaixa(v.config.honorarios_advocaticios_percent, 0, 100) &&
    naFaixa(c.taxa_locacao_percent, 0, 100) &&
    c.taxa_locacao_valor >= 0 &&
    v.foro.length <= 160 &&
    v.assinatura.cidade.length <= 120
  );
}

/** Espelha os `max()` de `locacaoRecebimentoSchema` — tudo texto livre. */
function recebimentoNaFaixa(r: LocacaoRecebimento): boolean {
  return (
    r.pix_chave.length <= 200 &&
    r.banco.length <= 80 &&
    r.agencia.length <= 20 &&
    r.conta.length <= 30 &&
    r.titular_nome.length <= 200 &&
    r.titular_doc.length <= 18
  );
}

function LocacaoDefaults({
  state,
  comissaoState,
  recebimentoState,
  autoSave,
}: {
  state: SettingsState<LocacaoSettings>;
  comissaoState: SettingsState<LocacaoComissaoDefaults>;
  recebimentoState: SettingsState<LocacaoRecebimento>;
  autoSave: AutoSave;
}) {
  const [values, setValues] = state;
  const [comissao, setComissao] = comissaoState;
  const [recebimento, setRecebimento] = recebimentoState;

  function patchComissao(next: Partial<LocacaoComissaoDefaults>) {
    setComissao((c) => ({ ...c, ...next }));
  }
  function patchRecebimento(next: Partial<LocacaoRecebimento>) {
    setRecebimento((r) => ({ ...r, ...next }));
  }

  function patchConfig(next: Partial<LocacaoSettings["config"]>) {
    setValues((v) => ({ ...v, config: { ...v.config, ...next } }));
  }
  function patchAssinatura(next: Partial<LocacaoSettings["assinatura"]>) {
    setValues((v) => ({ ...v, assinatura: { ...v.assinatura, ...next } }));
  }
  const num = (raw: string, fallback: number) => {
    // `Number("")` é 0, e 0 é finito — sem este guard, apagar o campo para
    // digitar outro valor gravava 0, que viola o `min(1)` do schema. Com
    // auto-save isso vira PATCH 400 no meio da digitação; campo vazio é
    // "ainda não digitou", não zero.
    if (raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-sm text-muted-foreground">Foro (comarca)</Label>
          <Input
            value={values.foro}
            placeholder="Ex.: São Paulo/SP"
            onChange={(e) =>
              setValues((v) => ({ ...v, foro: e.target.value }))
            }
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

      {/* Onde a imobiliária recebe essa comissão. Vira a chave
          `{{imobiliaria_dados_pagamento}}` da cláusula de corretagem — é o que
          tira a conta da imobiliária do TEXTO do modelo (dado bancário literal
          bloqueia a ativação). Só entra no contrato o que estiver completo:
          uma chave PIX, ou banco + agência + conta + tipo. */}
      <div className="space-y-4 rounded-md border border-border p-4">
        <div>
          <h4 className="text-sm font-medium">
            Onde a imobiliária recebe a comissão
          </h4>
          <p className="text-xs text-muted-foreground">
            Preenche a chave <code>{"{{imobiliaria_dados_pagamento}}"}</code> dos
            modelos de locação. Com a chave PIX informada, ela vale; sem PIX, a
            conta só entra no contrato quando banco, agência, conta e tipo
            estiverem preenchidos. Em branco, a chave sai vazia.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Tipo da chave PIX</Label>
            <NativeSelect
              value={recebimento.pix_tipo_chave}
              onChange={(v) =>
                patchRecebimento({
                  pix_tipo_chave:
                    v === "CPF" || v === "CNPJ" || v === "EMAIL" || v === "PHONE" || v === "EVP"
                      ? v
                      : "",
                })
              }
              options={[
                { value: "", label: "—" },
                { value: "CNPJ", label: "CNPJ" },
                { value: "CPF", label: "CPF" },
                { value: "EMAIL", label: "E-mail" },
                { value: "PHONE", label: "Telefone" },
                { value: "EVP", label: "Aleatória" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label className="text-sm text-muted-foreground">Chave PIX</Label>
            <Input
              value={recebimento.pix_chave}
              maxLength={200}
              placeholder="Ex.: 12.345.678/0001-90"
              onChange={(e) => patchRecebimento({ pix_chave: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Banco</Label>
            <Input
              value={recebimento.banco}
              maxLength={80}
              placeholder="Ex.: Itaú"
              onChange={(e) => patchRecebimento({ banco: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Agência</Label>
            <Input
              value={recebimento.agencia}
              maxLength={20}
              onChange={(e) => patchRecebimento({ agencia: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Conta</Label>
            <Input
              value={recebimento.conta}
              maxLength={30}
              onChange={(e) => patchRecebimento({ conta: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Tipo de conta</Label>
            <NativeSelect
              value={recebimento.tipo_conta}
              onChange={(v) =>
                patchRecebimento({
                  tipo_conta: v === "corrente" || v === "poupanca" ? v : "",
                })
              }
              options={[
                { value: "", label: "—" },
                { value: "corrente", label: "Corrente" },
                { value: "poupanca", label: "Poupança" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Titular</Label>
            <Input
              value={recebimento.titular_nome}
              maxLength={200}
              placeholder="Razão social, se diferente"
              onChange={(e) => patchRecebimento({ titular_nome: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">CNPJ/CPF do titular</Label>
            <Input
              value={recebimento.titular_doc}
              maxLength={18}
              onChange={(e) => patchRecebimento({ titular_doc: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setValues(DEFAULT_LOCACAO_SETTINGS);
            setComissao(DEFAULT_LOCACAO_COMISSAO);
            setRecebimento(DEFAULT_LOCACAO_RECEBIMENTO);
          }}
          disabled={autoSave.status === "saving"}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Restaurar sugerido
        </Button>
        <SaveStatusPill status={autoSave.status} isDirty={autoSave.isDirty} />
      </div>
    </div>
  );
}
