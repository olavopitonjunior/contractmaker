"use client";

import { useEffect } from "react";
import { useFieldArray, UseFormReturn, Controller } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { UFSelect } from "@/components/forms/UFSelect";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { NativeSelect } from "@/components/forms/NativeSelect";

interface ComissaoConfigStepProps {
  form: UseFormReturn<any>;
}

function FormField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  );
}

export function ComissaoConfigStep({ form }: ComissaoConfigStepProps) {
  const quemPaga = form.watch("comissao.quem_paga");
  const quandoPaga = form.watch("comissao.quando_paga");
  const permiteDesistencia = form.watch("desistencia.permite");
  const foro = form.watch("foro");

  const {
    fields: testemunhaFields,
    append: appendTestemunha,
    remove: removeTestemunha,
  } = useFieldArray({
    control: form.control,
    name: "testemunhas",
  });

  // Garante que sempre existem ao menos 2 testemunhas (padrão CCV).
  // Append em loop separado pra evitar setState durante render.
  useEffect(() => {
    if (testemunhaFields.length < 2) {
      const missing = 2 - testemunhaFields.length;
      for (let i = 0; i < missing; i++) {
        appendTestemunha({ nome: "", cpf: "", email: "" });
      }
    }
  }, [testemunhaFields.length, appendTestemunha]);

  // Comissionados — array dinâmico (corretora + intermediária + sub-corretor).
  // Hidrata 1º item a partir dos campos legados `imobiliaria_*` quando vazio,
  // pra suavizar formulários antigos. Garante pelo menos 1 entrada.
  const {
    fields: comissionadoFields,
    append: appendComissionado,
    remove: removeComissionado,
  } = useFieldArray({
    control: form.control,
    name: "comissao.comissionados",
  });

  useEffect(() => {
    if (comissionadoFields.length === 0) {
      const legacyNome = form.getValues("comissao.imobiliaria_nome") || "";
      const legacyDoc = form.getValues("comissao.imobiliaria_cnpj") || "";
      const legacyEmail = form.getValues("comissao.imobiliaria_email") || "";
      const legacyTipo =
        form.getValues("comissao.corretora_tipo_pessoa") || "juridica";
      const legacyCreci = form.getValues("comissao.creci") || "";
      const legacyFlag = !!form.getValues("comissao.incluir_como_signatario");
      appendComissionado({
        nome: legacyNome,
        tipo_pessoa: legacyTipo,
        cpf: legacyTipo === "fisica" ? legacyDoc : "",
        cnpj: legacyTipo !== "fisica" ? legacyDoc : "",
        creci: legacyCreci,
        email: legacyEmail,
        incluir_como_signatario: legacyFlag,
      });
    }
  }, [comissionadoFields.length, appendComissionado, form]);

  // Sync `comissionados[0]` → campos legados pra templates Handlebars que
  // ainda renderizam `comissao.imobiliaria_*` no corpo do contrato.
  // Watcher: dispara quando o usuário edita o 1º item.
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (!name?.startsWith("comissao.comissionados.0.")) return;
      const first = value?.comissao?.comissionados?.[0];
      if (!first) return;
      const tipo = first.tipo_pessoa || "juridica";
      const doc = tipo === "fisica" ? first.cpf || "" : first.cnpj || "";
      form.setValue("comissao.corretora_tipo_pessoa", tipo, {
        shouldDirty: false,
      });
      form.setValue("comissao.imobiliaria_nome", first.nome || "", {
        shouldDirty: false,
      });
      form.setValue("comissao.imobiliaria_cnpj", doc, { shouldDirty: false });
      form.setValue("comissao.imobiliaria_email", first.email || "", {
        shouldDirty: false,
      });
      form.setValue("comissao.creci", first.creci || "", {
        shouldDirty: false,
      });
      form.setValue(
        "comissao.incluir_como_signatario",
        !!first.incluir_como_signatario,
        { shouldDirty: false }
      );
    });
    return () => subscription.unsubscribe();
  }, [form]);

  return (
    <div className="space-y-4">
      {/* Comissão */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Comissão Imobiliária
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Valor da Comissão">
              <Controller
                control={form.control}
                name="comissao.valor"
                render={({ field }) => (
                  <MoneyInput
                    value={field.value || 0}
                    onChange={(v) => field.onChange(v)}
                  />
                )}
              />
            </FormField>

            <FormField label="Quem Paga a Comissão">
              <NativeSelect
                value={quemPaga || "comprador"}
                onChange={(v) => {
                  form.setValue("comissao.quem_paga", v, { shouldDirty: true });
                  const textos: Record<string, string> = {
                    comprador: "Parte Compradora",
                    vendedor: "Parte Vendedora",
                    ambos: "Ambas as Partes",
                    outro: "",
                  };
                  form.setValue("comissao.quem_paga_texto", textos[v] || "", { shouldDirty: true });
                }}
                options={[
                  { value: "comprador", label: "Comprador" },
                  { value: "vendedor", label: "Vendedor" },
                  { value: "ambos", label: "Ambos (50/50)" },
                  { value: "outro", label: "Outro" },
                ]}
              />
            </FormField>

            {quemPaga === "outro" && (
              <FormField label="Especificar quem paga" className="md:col-span-2">
                <Input
                  {...form.register("comissao.quem_paga_texto")}
                  placeholder="Especifique quem paga a comissão..."
                />
              </FormField>
            )}

            <FormField label="Quando Paga a Comissão">
              <NativeSelect
                value={quandoPaga || "assinatura"}
                onChange={(v) => form.setValue("comissao.quando_paga", v, { shouldDirty: true })}
                options={[
                  { value: "assinatura", label: "Na assinatura do contrato" },
                  { value: "quitacao", label: "Na quitação total" },
                  { value: "registro", label: "No registro da escritura" },
                  { value: "parcelas", label: "Em parcelas" },
                ]}
              />
            </FormField>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              Comissionados (Corretores e Imobiliárias)
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                appendComissionado({
                  nome: "",
                  tipo_pessoa: "juridica",
                  cpf: "",
                  cnpj: "",
                  creci: "",
                  email: "",
                  incluir_como_signatario: false,
                })
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Adicionar Comissionado
            </Button>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Suporta múltiplos corretores e imobiliárias dividindo a comissão.
            O primeiro entra no corpo do contrato; demais aparecem só como
            assinantes adicionais no envelope ClickSign.
          </p>

          {comissionadoFields.map((field, index) => {
            const tipoPath =
              `comissao.comissionados.${index}.tipo_pessoa` as const;
            const tipoPessoa = form.watch(tipoPath) || "juridica";
            return (
              <div
                key={field.id}
                className="rounded-md border p-4 space-y-3 bg-muted/20"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {index === 0
                      ? "Comissionado principal"
                      : `Comissionado ${index + 1}`}
                  </p>
                  {comissionadoFields.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => removeComissionado(index)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Remover
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Tipo de Cadastro" className="md:col-span-2">
                    <select
                      {...form.register(tipoPath)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="juridica">Imobiliária (PJ)</option>
                      <option value="fisica">Corretor autônomo (PF)</option>
                    </select>
                  </FormField>
                  <FormField
                    label={
                      tipoPessoa === "fisica"
                        ? "Nome do Corretor"
                        : "Nome da Imobiliária"
                    }
                    className="md:col-span-2"
                  >
                    <Input
                      {...form.register(`comissao.comissionados.${index}.nome`)}
                      placeholder={
                        tipoPessoa === "fisica"
                          ? "Nome completo"
                          : "Razão Social ou Nome Fantasia"
                      }
                    />
                  </FormField>
                  {tipoPessoa === "fisica" ? (
                    <FormField label="CPF do Corretor">
                      <Input
                        {...form.register(
                          `comissao.comissionados.${index}.cpf`
                        )}
                        placeholder="000.000.000-00"
                      />
                    </FormField>
                  ) : (
                    <FormField label="CNPJ da Imobiliária">
                      <Input
                        {...form.register(
                          `comissao.comissionados.${index}.cnpj`
                        )}
                        placeholder="00.000.000/0000-00"
                      />
                    </FormField>
                  )}
                  <FormField label="CRECI">
                    <Input
                      {...form.register(
                        `comissao.comissionados.${index}.creci`
                      )}
                      placeholder={
                        tipoPessoa === "fisica" ? "Ex: 199.905" : "Ex: J-12345"
                      }
                    />
                  </FormField>
                  <FormField
                    label="E-mail (para assinatura digital)"
                    className="md:col-span-2"
                  >
                    <Input
                      type="email"
                      {...form.register(
                        `comissao.comissionados.${index}.email`
                      )}
                      placeholder="contato@imobiliaria.com"
                    />
                  </FormField>
                  <Controller
                    control={form.control}
                    name={`comissao.comissionados.${index}.incluir_como_signatario`}
                    render={({ field: cf }) => (
                      <div className="md:col-span-2">
                        <CheckboxField
                          id={`incluir-comissionado-${index}`}
                          label="Incluir como signatário no envelope"
                          checked={!!cf.value}
                          onChange={cf.onChange}
                        />
                      </div>
                    )}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Desistencia */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Cláusula de Desistência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CheckboxField
            id="permite-desistencia"
            label="Permite desistência do negócio dentro de prazo"
            checked={!!permiteDesistencia}
            onChange={(v) => form.setValue("desistencia.permite", v)}
          />

          {permiteDesistencia && (
            <FormField label="Prazo para desistência (dias)" className="max-w-xs">
              <Input
                type="number"
                min="1"
                {...form.register("desistencia.prazo_dias", {
                  valueAsNumber: true,
                })}
                placeholder="7"
              />
            </FormField>
          )}
        </CardContent>
      </Card>

      {/* Foro */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Foro de Resolução de Disputas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="Forma de resolução de conflitos">
            <NativeSelect
              className="w-full md:w-80"
              value={foro || "arbitragem"}
              onChange={(v) => form.setValue("foro", v, { shouldDirty: true })}
              options={[
                { value: "arbitragem", label: "Arbitragem" },
                { value: "justica-publica", label: "Justiça Comum" },
              ]}
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Assinatura */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Local e Data de Assinatura
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="Cidade" className="md:col-span-1">
              <Input
                {...form.register("assinatura.cidade")}
                placeholder="Cidade"
              />
            </FormField>
            <FormField label="UF">
              <UFSelect
                value={form.watch("assinatura.uf")}
                onChange={(v) => form.setValue("assinatura.uf", v, { shouldDirty: true })}
              />
            </FormField>
            <FormField label="Data">
              <Input type="date" {...form.register("assinatura.data")} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {/* Testemunhas */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Testemunhas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {testemunhaFields.map((field, index) => (
            <div key={field.id} className="space-y-3">
              {index > 0 && <Separator />}
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  Testemunha {index + 1}
                </p>
                {index >= 2 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => removeTestemunha(index)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remover
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Nome">
                  <Input
                    {...form.register(`testemunhas.${index}.nome`)}
                    placeholder="Nome completo"
                  />
                </FormField>
                <FormField label="CPF">
                  <Input
                    {...form.register(`testemunhas.${index}.cpf`)}
                    placeholder="000.000.000-00"
                  />
                </FormField>
                <FormField label="E-mail (para assinatura digital)" className="md:col-span-2">
                  <Input
                    type="email"
                    {...form.register(`testemunhas.${index}.email`)}
                    placeholder="testemunha@email.com"
                  />
                </FormField>
              </div>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              appendTestemunha({ nome: "", cpf: "", email: "" })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Adicionar testemunha
          </Button>
        </CardContent>
      </Card>

      {/* Configurações Contratuais */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Configurações Contratuais
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Multa Penal Moratória (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                {...form.register("config.multa_penal_moratoria", {
                  valueAsNumber: true,
                })}
                placeholder="2"
              />
            </FormField>

            <FormField label="Base de Cálculo da Multa">
              <Input
                {...form.register("config.base_calculo_multa")}
                placeholder="valor da parcela"
              />
            </FormField>

            <FormField label="Juros por Atraso (% ao mês)">
              <Input
                type="number"
                step="0.01"
                min="0"
                {...form.register("config.juros_mensais_atraso", {
                  valueAsNumber: true,
                })}
                placeholder="1"
              />
            </FormField>

            <FormField label="Atualização Monetária">
              <Input
                {...form.register("config.atualizacao_monetaria")}
                placeholder="IPCA"
              />
            </FormField>

            <FormField label="Prazo de Atraso para Rescisão (dias)">
              <Input
                type="number"
                min="1"
                {...form.register("config.prazo_atraso_rescisao", {
                  valueAsNumber: true,
                })}
                placeholder="10"
              />
            </FormField>

            <FormField label="Multa Cominatória Diária">
              <Controller
                control={form.control}
                name="config.multa_cominatoria_diaria"
                render={({ field }) => (
                  <MoneyInput
                    value={field.value || 0}
                    onChange={(v) => field.onChange(v)}
                  />
                )}
              />
            </FormField>

            <FormField label="Multa Penal Compensatória (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                {...form.register("config.multa_penal_compensatoria", {
                  valueAsNumber: true,
                })}
                placeholder="10"
              />
            </FormField>

            <FormField label="Prazo para Multa Rescisória (dias)">
              <Input
                type="number"
                min="1"
                {...form.register("config.prazo_multa_rescisoria", {
                  valueAsNumber: true,
                })}
                placeholder="7"
              />
            </FormField>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
