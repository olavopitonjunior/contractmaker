"use client";

import { useCallback } from "react";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, UserPlus, Building2 } from "lucide-react";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { DecimalField, MoneyField } from "./_PartyFields";
import { taxaLocacaoValor } from "@/lib/locacao/commission";
import { formatMoneyBR } from "@/lib/format/money";
import { FormField } from "@/components/forms/fields/FormField";
import { maskCPF, maskCNPJ, maskTelefone } from "@/lib/forms/field-formats";
import { CadastroRecebimento } from "../CadastroRecebimento";
import {
  CorretorCombobox,
  type CorretorComboboxPage,
} from "@/components/corretores/CorretorCombobox";

const FORMA_COMISSAO_OPTIONS = [
  { value: "percentual", label: "% do aluguel mensal" },
  { value: "valor_fixo", label: "Valor fixo mensal (R$)" },
];

/**
 * Etapa Comissão do form público de LOCAÇÃO — paridade com o
 * `ComissaoConfigStep` de venda: taxa de locação (one-shot) + angariadores
 * (comissão recorrente), com o MESMO fluxo de cadastro de corretor: picker
 * "Selecionar cadastrado" (lookup em /api/forms/[token]/commissioners — a rota
 * resolve SalesForm.token e serve as duas esteiras), sem duplicação
 * (findCommissionerMatch no servidor) e autopreenchimento do já cadastrado.
 *
 * Visível só no token principal — `comissao` fica fora do escopo dos subtokens
 * (role-paths), como em venda.
 */
export function ComissaoLocacaoStep({
  form,
  token,
  viewerIsMember = false,
  requireCommissionerReceiving = false,
}: {
  form: UseFormReturn<any>;
  token?: string;
  viewerIsMember?: boolean;
  /** A imobiliária exige os dados de recebimento do corretor nesta etapa. */
  requireCommissionerReceiving?: boolean;
}) {
  // `useCallback` NÃO é detalhe: `CorretorCombobox` tem `fetchOptions` nas
  // dependências do efeito de busca. Sem identidade estável, era uma requisição
  // a cada render — ~1 a cada 300ms contra um teto de 30/min — e o 429 chegava
  // em ~9 segundos disfarçado de "Nenhum corretor encontrado". Foi assim que a
  // listagem sumiu em venda até 08/2026; esta esteira nasceu de uma cópia
  // anterior ao conserto e usava um `<datalist>` próprio que engolia o erro.
  const fetchCommissionerOptions = useCallback(
    async (q: string): Promise<CorretorComboboxPage> => {
      if (!token) return [];
      const url = `/api/forms/${token}/commissioners${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      const res = await fetch(url);
      // Lançar é deliberado: o combobox tem estado de FALHA separado de "lista
      // vazia", e engolir aqui devolveria a mentira que já custou uma queixa.
      if (!res.ok) throw new Error(`commissioners ${res.status}`);
      const data = await res.json();
      return {
        items: Array.isArray(data?.items) ? data.items : [],
        hasMore: data?.hasMore === true,
      };
    },
    [token]
  );

  const {
    fields: angariadorFields,
    append: appendAngariador,
    remove: removeAngariador,
  } = useFieldArray({
    control: form.control,
    name: "comissao.angariadores",
  });

  // A taxa da imobiliária ganhou as duas formas (a do angariador já tinha):
  // "R$ 800 pela intermediação" não tinha onde ser dito.
  const formaTaxa =
    form.watch("comissao.forma_taxa_locacao") === "valor_fixo"
      ? "valor_fixo"
      : "percentual";
  const previewTaxa = taxaLocacaoValor(
    form.watch("aluguel.valor"),
    form.watch("comissao.taxa_locacao_percent")
  );

  const somaPercentuais = angariadorFields.reduce((acc, _f, i) => {
    if (form.watch(`comissao.angariadores.${i}.forma_comissao`) === "valor_fixo") return acc;
    const v = Number(form.watch(`comissao.angariadores.${i}.percentual`));
    // valueAsNumber de input vazio é NaN — somá-lo mataria o aviso de >100%.
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);

  return (
    <div className="space-y-4">
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Comissão da Locação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              form={form}
              name="comissao.forma_taxa_locacao"
              label="Taxa de intermediação (1º aluguel)"
              hint="Devida uma única vez à imobiliária pela intermediação da locação."
            >
              <NativeSelect
                value={formaTaxa}
                onChange={(v) =>
                  form.setValue("comissao.forma_taxa_locacao", v, {
                    shouldDirty: true,
                  })
                }
                options={FORMA_COMISSAO_OPTIONS.map((o) =>
                  o.value === "percentual"
                    ? { ...o, label: "% do primeiro aluguel" }
                    : { ...o, label: "Valor fixo (R$)" }
                )}
              />
            </FormField>
            {formaTaxa === "valor_fixo" ? (
              <FormField
                form={form}
                name="comissao.taxa_locacao_valor"
                label="Valor da taxa (R$)"
              >
                <MoneyField
                  form={form}
                  name="comissao.taxa_locacao_valor"
                  placeholder="Ex: 800,00"
                />
              </FormField>
            ) : (
              <FormField
                form={form}
                name="comissao.taxa_locacao_percent"
                label="Percentual (%)"
                hint={
                  previewTaxa > 0
                    ? `Equivale a ${formatMoneyBR(previewTaxa)} sobre o aluguel informado.`
                    : "100% = um aluguel inteiro, o mais comum no mercado."
                }
              >
                <DecimalField
                  form={form}
                  name="comissao.taxa_locacao_percent"
                  suffix="%"
                  min={0}
                  max={100}
                  placeholder="Ex: 100"
                />
              </FormField>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <p className="text-sm font-semibold w-full">Corretores / angariadores</p>
            {token && (
              <CorretorCombobox
                fetchOptions={fetchCommissionerOptions}
                onSelect={(r) => {
                  const isPF = r.tipoPessoa === "fisica";
                  appendAngariador({
                    splitRecipientId: r.id,
                    nome: r.label,
                    tipo_pessoa: isPF ? "fisica" : "juridica",
                    // O endpoint token-scoped devolve o doc MASCARADO
                    // (anti-scraping, ex. "390***05") — persistir isso em
                    // dataJson envenenaria ClickSign/DIMOB/qualificação, furava
                    // o dedupe por documento (normalizeDoc via 5 dígitos) e
                    // criava PropertyOwner com doc falso no materialize-parties.
                    // O vínculo real é splitRecipientId; o doc fica vazio pra
                    // quem preenche completar (ou o finalize resolver).
                    cpf: "",
                    cnpj: "",
                    creci: r.creci ?? "",
                    email: r.email ?? "",
                    mobile_phone: r.phone ?? "",
                    forma_comissao: "percentual",
                    // Estado do cadastro (booleano): alimenta o gate de
                    // recebimento da etapa quando a imobiliária o exige.
                    recebimentoPendente: r.receivingPending === true,
                    // Dados bancários do cadastro — só vêm para membro da org.
                    ...(r.recebimento ? { recebimento: r.recebimento } : {}),
                  });
                  toast.success(`${r.label} adicionado(a) como angariador(a).`);
                }}
                placeholder="Selecionar cadastrado"
                className="w-64"
              />
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                appendAngariador({
                  nome: "",
                  tipo_pessoa: "fisica",
                  forma_comissao: "percentual",
                })
              }
            >
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Novo corretor (PF)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                appendAngariador({
                  nome: "",
                  tipo_pessoa: "juridica",
                  forma_comissao: "percentual",
                })
              }
            >
              <Building2 className="h-3.5 w-3.5 mr-1.5" /> Nova imobiliária (PJ)
            </Button>
          </div>


          {angariadorFields.map((field, index) => {
            const base = `comissao.angariadores.${index}`;
            const tipoPessoa = form.watch(`${base}.tipo_pessoa`) || "fisica";
            const formaComissao = form.watch(`${base}.forma_comissao`) || "percentual";
            const splitRecipientId = form.watch(`${base}.splitRecipientId`) as
              | string
              | undefined;
            return (
              <div key={field.id} className="rounded-lg border border-border p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">
                      {tipoPessoa === "fisica" ? "Corretor" : "Imobiliária"} {index + 1}
                    </p>
                    {splitRecipientId && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Cadastro vinculado
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeAngariador(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    form={form}
                    name={`${base}.nome`}
                    label={tipoPessoa === "fisica" ? "Nome do corretor" : "Nome da imobiliária"}
                    required
                  >
                    <Input {...form.register(`${base}.nome`)} placeholder="Nome completo" />
                  </FormField>
                  {tipoPessoa === "fisica" ? (
                    <FormField form={form} name={`${base}.cpf`} label="CPF">
                      <Input
                        value={form.watch(`${base}.cpf`) || ""}
                        onChange={(e) =>
                          form.setValue(`${base}.cpf`, maskCPF(e.target.value), {
                            shouldDirty: true,
                          })
                        }
                        placeholder="000.000.000-00"
                      />
                    </FormField>
                  ) : (
                    <FormField form={form} name={`${base}.cnpj`} label="CNPJ">
                      <Input
                        value={form.watch(`${base}.cnpj`) || ""}
                        onChange={(e) =>
                          form.setValue(`${base}.cnpj`, maskCNPJ(e.target.value), {
                            shouldDirty: true,
                          })
                        }
                        placeholder="00.000.000/0000-00"
                      />
                    </FormField>
                  )}
                  <FormField form={form} name={`${base}.creci`} label="CRECI">
                    <Input {...form.register(`${base}.creci`)} placeholder="Ex: 123456-F" />
                  </FormField>
                  <FormField form={form} name={`${base}.email`} label="E-mail">
                    <Input
                      {...form.register(`${base}.email`)}
                      type="email"
                      placeholder="email@exemplo.com"
                    />
                  </FormField>
                  <FormField form={form} name={`${base}.mobile_phone`} label="Celular (com DDD)">
                    <Input
                      value={form.watch(`${base}.mobile_phone`) || ""}
                      onChange={(e) =>
                        form.setValue(`${base}.mobile_phone`, maskTelefone(e.target.value), {
                          shouldDirty: true,
                        })
                      }
                      placeholder="(11) 99999-9999"
                    />
                  </FormField>
                  <FormField
                    form={form}
                    name={`${base}.forma_comissao`}
                    label="Forma da comissão recorrente"
                  >
                    <NativeSelect
                      value={formaComissao}
                      onChange={(v) =>
                        form.setValue(`${base}.forma_comissao`, v, { shouldDirty: true })
                      }
                      options={FORMA_COMISSAO_OPTIONS}
                    />
                  </FormField>
                  {formaComissao === "valor_fixo" ? (
                    <FormField form={form} name={`${base}.valor_fixo`} label="Valor fixo mensal (R$)">
                      <MoneyField form={form} name={`${base}.valor_fixo`} placeholder="Ex: 150,00" />
                    </FormField>
                  ) : (
                    <FormField form={form} name={`${base}.percentual`} label="Percentual do aluguel (%)">
                      <DecimalField
                        form={form}
                        name={`${base}.percentual`}
                        suffix="%"
                        min={0}
                        max={100}
                        placeholder="Ex: 5"
                      />
                    </FormField>
                  )}
                  <FormField form={form} name={`${base}.meses_comissao`} label="Duração (meses; vazio = todo o contrato)">
                    <Input
                      {...form.register(`${base}.meses_comissao`, { valueAsNumber: true })}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="Todo o contrato"
                    />
                  </FormField>
                </div>

                {token && (
                  <CadastroRecebimento
                    form={form}
                    basePath={base}
                    endpoint={`/api/forms/${token}/commissioners`}
                    papelDefault="captador"
                    showReceiving={viewerIsMember}
                    required={requireCommissionerReceiving}
                  />
                )}
              </div>
            );
          })}

          {angariadorFields.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum angariador informado — apenas a taxa de locação será considerada.
            </p>
          )}

          {somaPercentuais > 100 && (
            <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              A soma dos percentuais recorrentes passa de 100% ({somaPercentuais}%).
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
