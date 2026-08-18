"use client";

import { useEffect, useId, useState } from "react";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, UserPlus, Building2, Search } from "lucide-react";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { MoneyField, FormField } from "./_PartyFields";
import { maskCPF, maskCNPJ, maskTelefone } from "@/lib/forms/field-formats";
import { CadastroRecebimento } from "../CadastroRecebimento";

interface CommissionerLookup {
  id: string;
  label: string;
  tipoPessoa: string | null;
  doc: string | null;
  creci: string | null;
  papel: string | null;
  email: string | null;
  phone: string | null;
}

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
}: {
  form: UseFormReturn<any>;
  token?: string;
  viewerIsMember?: boolean;
}) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<CommissionerLookup[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const datalistId = useId();

  useEffect(() => {
    if (!lookupOpen || !token) return;
    let cancelled = false;
    setLookupLoading(true);
    const q = lookupQuery.trim();
    const url = `/api/forms/${token}/commissioners${q ? `?q=${encodeURIComponent(q)}` : ""}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (!cancelled) setLookupResults(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setLookupResults([]);
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lookupOpen, lookupQuery, token]);

  const {
    fields: angariadorFields,
    append: appendAngariador,
    remove: removeAngariador,
  } = useFieldArray({
    control: form.control,
    name: "comissao.angariadores",
  });

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
            <FormField label="Taxa de locação (% sobre o 1º aluguel)">
              <Input
                {...form.register("comissao.taxa_locacao_percent", { valueAsNumber: true })}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.5"
                placeholder="Ex: 100"
              />
            </FormField>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <p className="text-sm font-semibold w-full">Corretores / angariadores</p>
            {token && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setLookupOpen((v) => !v)}
              >
                <Search className="h-3.5 w-3.5 mr-1.5" /> Selecionar cadastrado
              </Button>
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

          {lookupOpen && token && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  list={datalistId}
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="Buscar por nome, CPF/CNPJ ou CRECI..."
                  className="bg-background"
                />
              </div>
              <datalist id={datalistId}>
                {lookupResults.map((r) => (
                  <option key={r.id} value={r.label}>
                    {r.label} — {r.tipoPessoa === "fisica" ? "Corretor" : "Imobiliária"}
                    {r.creci ? ` · CRECI ${r.creci}` : ""}
                  </option>
                ))}
              </datalist>
              {lookupLoading && <p className="text-xs text-muted-foreground">Buscando...</p>}
              {!lookupLoading && lookupResults.length === 0 && lookupQuery && (
                <p className="text-xs text-muted-foreground">
                  Nenhum cadastrado encontrado. Use os botões acima pra cadastrar.
                </p>
              )}
              {!lookupLoading && lookupResults.length > 0 && (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {lookupResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        const isPF = r.tipoPessoa === "fisica";
                        appendAngariador({
                          splitRecipientId: r.id,
                          nome: r.label,
                          tipo_pessoa: isPF ? "fisica" : "juridica",
                          cpf: isPF ? (r.doc ?? "") : "",
                          cnpj: !isPF ? (r.doc ?? "") : "",
                          creci: r.creci ?? "",
                          email: r.email ?? "",
                          mobile_phone: r.phone ?? "",
                          forma_comissao: "percentual",
                        });
                        toast.success(`${r.label} adicionado(a) como angariador(a).`);
                        setLookupOpen(false);
                      }}
                      className="w-full text-left rounded border bg-background hover:bg-accent p-2 text-sm transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.tipoPessoa === "fisica" ? "Corretor" : "Imobiliária"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.doc ?? ""}
                        {r.creci ? ` · CRECI ${r.creci}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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
                    label={tipoPessoa === "fisica" ? "Nome do corretor *" : "Nome da imobiliária *"}
                  >
                    <Input {...form.register(`${base}.nome`)} placeholder="Nome completo" />
                  </FormField>
                  {tipoPessoa === "fisica" ? (
                    <FormField label="CPF">
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
                    <FormField label="CNPJ">
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
                  <FormField label="CRECI">
                    <Input {...form.register(`${base}.creci`)} placeholder="Ex: 123456-F" />
                  </FormField>
                  <FormField label="E-mail">
                    <Input
                      {...form.register(`${base}.email`)}
                      type="email"
                      placeholder="email@exemplo.com"
                    />
                  </FormField>
                  <FormField label="Celular (com DDD)">
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
                  <FormField label="Forma da comissão recorrente">
                    <NativeSelect
                      value={formaComissao}
                      onChange={(v) =>
                        form.setValue(`${base}.forma_comissao`, v, { shouldDirty: true })
                      }
                      options={FORMA_COMISSAO_OPTIONS}
                    />
                  </FormField>
                  {formaComissao === "valor_fixo" ? (
                    <FormField label="Valor fixo mensal (R$)">
                      <MoneyField form={form} name={`${base}.valor_fixo`} placeholder="Ex: 150,00" />
                    </FormField>
                  ) : (
                    <FormField label="Percentual do aluguel (%)">
                      <Input
                        {...form.register(`${base}.percentual`, { valueAsNumber: true })}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="0.5"
                        placeholder="Ex: 5"
                      />
                    </FormField>
                  )}
                  <FormField label="Duração (meses; vazio = todo o contrato)">
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
