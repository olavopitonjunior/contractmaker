"use client";

import { Controller, useFieldArray, UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { FormField } from "@/components/forms/fields/FormField";
import { ConjugeFields } from "@/components/forms/steps/ConjugeFields";
import {
  maskCPF,
  maskCNPJ,
  maskCEP,
  maskTelefone,
  cpfRule,
  cnpjRule,
  cepRule,
  telefoneRule,
  dataNascimentoRule,
  nomeCompletoRule,
} from "@/lib/forms/field-formats";

// Campos de parte (locador/locatário/fiador) bindados ao parteLocacaoSchema de
// lib/forms/validation-locacao.ts. Reaproveitado por LocadorStep, LocatarioStep
// e o sub-form de fiador do GarantiaStep. PF/PJ via discriminated union.

const ESTADOS_CIVIS = [
  "Solteiro(a)",
  "Casado(a)",
  "Divorciado(a)",
  "Viúvo(a)",
  "União Estável",
  "Separado(a)",
];

/**
 * Campo monetário (R$) do form de locação. MoneyInput formata em pt-BR e
 * devolve NÚMERO — o shape que o schema espera. Compartilhado pelos steps.
 */
export function MoneyField({
  form,
  name,
  placeholder,
}: {
  form: UseFormReturn<any>;
  name: string;
  placeholder?: string;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <MoneyInput
          value={Number(field.value) || 0}
          onChange={(v) => field.onChange(v)}
          placeholder={placeholder}
        />
      )}
    />
  );
}

export function PessoaFisicaLocacaoFields({
  form,
  prefix,
}: {
  form: UseFormReturn<any>;
  prefix: string;
}) {
  const estadoCivil = form.watch(`${prefix}.estado_civil`);
  const showConjuge =
    estadoCivil === "Casado(a)" || estadoCivil === "União Estável";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField form={form} name={`${prefix}.nome`} label="Nome Completo">
          <Input
            {...form.register(`${prefix}.nome`, { validate: nomeCompletoRule })}
            placeholder="Nome completo"
          />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.nacionalidade`}
          label="Nacionalidade"
        >
          <Input {...form.register(`${prefix}.nacionalidade`)} placeholder="Brasileiro(a)" />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.estado_civil`}
          label="Estado Civil"
        >
          <NativeSelect
            value={form.watch(`${prefix}.estado_civil`) || ""}
            placeholder="Selecione…"
            onChange={(v) => form.setValue(`${prefix}.estado_civil`, v, { shouldDirty: true })}
            options={ESTADOS_CIVIS.map((ec) => ({ value: ec, label: ec }))}
          />
        </FormField>
        <FormField form={form} name={`${prefix}.profissao`} label="Profissão">
          <Input {...form.register(`${prefix}.profissao`)} placeholder="Profissão" />
        </FormField>
        <FormField form={form} name={`${prefix}.rg`} label="RG">
          <Input {...form.register(`${prefix}.rg`)} placeholder="RG" />
        </FormField>
        <FormField form={form} name={`${prefix}.cpf`} label="CPF">
          <Input
            {...form.register(`${prefix}.cpf`, {
              validate: cpfRule,
              onChange: (e) =>
                form.setValue(`${prefix}.cpf`, maskCPF(e.target.value), {
                  shouldDirty: true,
                  shouldValidate: true,
                }),
            })}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.data_nascimento`}
          label="Data de Nascimento"
        >
          <Input
            {...form.register(`${prefix}.data_nascimento`, { validate: dataNascimentoRule })}
            type="date"
          />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.renda_mensal`}
          label="Renda mensal (R$)"
        >
          <MoneyField form={form} name={`${prefix}.renda_mensal`} placeholder="Ex: 8.000,00" />
        </FormField>
        <FormField form={form} name={`${prefix}.email`} label="Email">
          <Input {...form.register(`${prefix}.email`)} type="email" placeholder="email@exemplo.com" />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.mobile_phone`}
          label="Celular (com DDD)"
        >
          <Input
            {...form.register(`${prefix}.mobile_phone`, {
              validate: telefoneRule,
              onChange: (e) =>
                form.setValue(`${prefix}.mobile_phone`, maskTelefone(e.target.value), {
                  shouldDirty: true,
                  shouldValidate: true,
                }),
            })}
            type="tel"
            inputMode="numeric"
            placeholder="(11) 99999-9999"
          />
        </FormField>
      </div>

      <Separator />
      <p className="text-sm font-semibold text-foreground">Endereço</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          form={form}
          name={`${prefix}.endereco`}
          label="Logradouro"
          className="md:col-span-2"
        >
          <Input {...form.register(`${prefix}.endereco`)} placeholder="Rua, Avenida..." />
        </FormField>
        <FormField form={form} name={`${prefix}.numero`} label="Número">
          <Input {...form.register(`${prefix}.numero`)} placeholder="123" />
        </FormField>
        <FormField form={form} name={`${prefix}.complemento`} label="Complemento">
          <Input {...form.register(`${prefix}.complemento`)} placeholder="Apto, Sala..." />
        </FormField>
        <FormField form={form} name={`${prefix}.bairro`} label="Bairro">
          <Input {...form.register(`${prefix}.bairro`)} placeholder="Bairro" />
        </FormField>
        <FormField form={form} name={`${prefix}.cidade`} label="Cidade">
          <Input {...form.register(`${prefix}.cidade`)} placeholder="Cidade" />
        </FormField>
        <FormField form={form} name={`${prefix}.uf`} label="UF">
          <UFSelect
            value={form.watch(`${prefix}.uf`)}
            onChange={(v) => form.setValue(`${prefix}.uf`, v, { shouldDirty: true })}
          />
        </FormField>
        <FormField form={form} name={`${prefix}.cep`} label="CEP">
          <Input
            {...form.register(`${prefix}.cep`, {
              validate: cepRule,
              onChange: (e) =>
                form.setValue(`${prefix}.cep`, maskCEP(e.target.value), {
                  shouldDirty: true,
                  shouldValidate: true,
                }),
            })}
            inputMode="numeric"
            placeholder="00000-000"
          />
        </FormField>
      </div>

      {/* Outorga uxória: cônjuge de parte casada assina junto. Um único ponto
          de render cobre locador, locatário e fiador — os três passam por aqui. */}
      {showConjuge && (
        <ConjugeFields form={form} prefix={prefix} variant="locacao" />
      )}
    </div>
  );
}

export function PessoaJuridicaLocacaoFields({
  form,
  prefix,
}: {
  form: UseFormReturn<any>;
  prefix: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          form={form}
          name={`${prefix}.razao_social`}
          label="Razão Social"
          className="md:col-span-2"
        >
          <Input {...form.register(`${prefix}.razao_social`)} placeholder="Razão Social da empresa" />
        </FormField>
        <FormField form={form} name={`${prefix}.cnpj`} label="CNPJ">
          <Input
            {...form.register(`${prefix}.cnpj`, {
              validate: cnpjRule,
              onChange: (e) =>
                form.setValue(`${prefix}.cnpj`, maskCNPJ(e.target.value), {
                  shouldDirty: true,
                  shouldValidate: true,
                }),
            })}
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
          />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.faturamento_mensal`}
          label="Faturamento mensal (R$)"
        >
          <MoneyField
            form={form}
            name={`${prefix}.faturamento_mensal`}
            placeholder="Ex: 50.000,00"
          />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.endereco`}
          label="Logradouro"
          className="md:col-span-2"
        >
          <Input {...form.register(`${prefix}.endereco`)} placeholder="Rua, Avenida..." />
        </FormField>
        <FormField form={form} name={`${prefix}.numero`} label="Número">
          <Input {...form.register(`${prefix}.numero`)} placeholder="123" />
        </FormField>
        <FormField form={form} name={`${prefix}.complemento`} label="Complemento">
          <Input {...form.register(`${prefix}.complemento`)} placeholder="Sala, Andar..." />
        </FormField>
        <FormField form={form} name={`${prefix}.bairro`} label="Bairro">
          <Input {...form.register(`${prefix}.bairro`)} placeholder="Bairro" />
        </FormField>
        <FormField form={form} name={`${prefix}.cidade`} label="Cidade">
          <Input {...form.register(`${prefix}.cidade`)} placeholder="Cidade" />
        </FormField>
        <FormField form={form} name={`${prefix}.uf`} label="UF">
          <UFSelect
            value={form.watch(`${prefix}.uf`)}
            onChange={(v) => form.setValue(`${prefix}.uf`, v, { shouldDirty: true })}
          />
        </FormField>
        <FormField form={form} name={`${prefix}.cep`} label="CEP">
          <Input
            {...form.register(`${prefix}.cep`, {
              validate: cepRule,
              onChange: (e) =>
                form.setValue(`${prefix}.cep`, maskCEP(e.target.value), {
                  shouldDirty: true,
                  shouldValidate: true,
                }),
            })}
            inputMode="numeric"
            placeholder="00000-000"
          />
        </FormField>
      </div>

      <Separator />
      <p className="text-sm font-semibold text-foreground">Representante Legal</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          form={form}
          name={`${prefix}.representante.nome`}
          label="Nome"
          className="md:col-span-2"
        >
          <Input
            {...form.register(`${prefix}.representante.nome`, { validate: nomeCompletoRule })}
            placeholder="Nome completo"
          />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.representante.cpf`}
          label="CPF"
        >
          <Input
            {...form.register(`${prefix}.representante.cpf`, {
              validate: cpfRule,
              onChange: (e) =>
                form.setValue(`${prefix}.representante.cpf`, maskCPF(e.target.value), {
                  shouldDirty: true,
                  shouldValidate: true,
                }),
            })}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.representante.email`}
          label="Email"
        >
          <Input {...form.register(`${prefix}.representante.email`)} type="email" placeholder="email@exemplo.com" />
        </FormField>
        <FormField
          form={form}
          name={`${prefix}.representante.mobile_phone`}
          label="Celular"
        >
          <Input
            {...form.register(`${prefix}.representante.mobile_phone`, {
              validate: telefoneRule,
              onChange: (e) =>
                form.setValue(
                  `${prefix}.representante.mobile_phone`,
                  maskTelefone(e.target.value),
                  { shouldDirty: true, shouldValidate: true },
                ),
            })}
            type="tel"
            inputMode="numeric"
            placeholder="(11) 99999-9999"
          />
        </FormField>
      </div>
    </div>
  );
}

/**
 * Step reutilizável de array de partes (locadores/locatários). PF/PJ toggle por
 * card; checkbox "incluir como signatário" (default true) controla a inclusão na
 * assinatura ClickSign. `listKey` é o nome do campo no form (locadores|locatarios).
 */
export function LocacaoParteStep({
  form,
  listKey,
  singular,
}: {
  form: UseFormReturn<any>;
  listKey: "locadores" | "locatarios";
  singular: string;
}) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: listKey });

  const addParte = () =>
    append({
      tipo_pessoa: "fisica",
      nome: "",
      nacionalidade: "Brasileiro(a)",
      estado_civil: "", // vazio => select mostra "Selecione…"; força escolha (outorga)
      incluir_como_signatario: true,
    });

  return (
    <div className="space-y-4">
      {fields.map((field, index) => {
        const prefix = `${listKey}.${index}`;
        const tipoPessoa = form.watch(`${prefix}.tipo_pessoa`);
        return (
          <Card key={field.id} className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  {singular} {index + 1}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="flex rounded-md border border-input overflow-hidden">
                    <button
                      type="button"
                      onClick={() => form.setValue(`${prefix}.tipo_pessoa`, "fisica", { shouldDirty: true })}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        tipoPessoa !== "juridica"
                          ? "bg-primary text-primary-foreground"
                          : "bg-transparent text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pessoa Física
                    </button>
                    <button
                      type="button"
                      onClick={() => form.setValue(`${prefix}.tipo_pessoa`, "juridica", { shouldDirty: true })}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        tipoPessoa === "juridica"
                          ? "bg-primary text-primary-foreground"
                          : "bg-transparent text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pessoa Jurídica
                    </button>
                  </div>
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => remove(index)}
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      Remover
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {tipoPessoa === "juridica" ? (
                <PessoaJuridicaLocacaoFields form={form} prefix={prefix} />
              ) : (
                <PessoaFisicaLocacaoFields form={form} prefix={prefix} />
              )}
              <div className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`${prefix}-signatario`}
                  className="h-4 w-4 rounded border-input accent-primary"
                  defaultChecked
                  {...form.register(`${prefix}.incluir_como_signatario`)}
                />
                <Label htmlFor={`${prefix}-signatario`} className="cursor-pointer text-sm">
                  Incluir como signatário do contrato
                </Label>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Button type="button" variant="outline" onClick={addParte} className="w-full border-dashed">
        + Adicionar {singular}
      </Button>
    </div>
  );
}
