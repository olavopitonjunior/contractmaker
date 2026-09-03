"use client";

import { useFieldArray, UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { FormField } from "@/components/forms/fields/FormField";
import { ConjugeFields } from "@/components/forms/steps/ConjugeFields";
import { ProcuradorFields } from "@/components/forms/steps/ProcuradorFields";
import { RepresentanteFields } from "@/components/forms/steps/RepresentanteFields";
import { maskCPF, maskCNPJ, maskCEP, maskTelefone } from "@/lib/forms/field-formats";

interface CompradorStepProps {
  form: UseFormReturn<any>;
}

const ESTADOS_CIVIS = [
  "Solteiro(a)",
  "Casado(a)",
  "Divorciado(a)",
  "Viúvo(a)",
  "União Estável",
  "Separado(a)",
];

function PessoaFisicaFields({
  form,
  prefix,
}: {
  form: UseFormReturn<any>;
  prefix: string;
}) {
  const estadoCivil = form.watch(`${prefix}.estado_civil`);
  const temProcurador = form.watch(`${prefix}.tem_procurador`);
  const temSocioPj = form.watch(`${prefix}.tem_socio_pj`);
  const showConjuge =
    estadoCivil === "Casado(a)" || estadoCivil === "União Estável";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Ver VendedorStep: a obrigatoriedade do nome é da imobiliária
            (`compradores.0.nome` tem checkbox em Configurações → Formulário).
            Aqui fica só regra de FORMATO, e só para campo preenchido. */}
        <FormField form={form} name={`${prefix}.nome`} label="Nome Completo">
          <Input
            {...form.register(`${prefix}.nome`, {
              validate: (v) =>
                !v || String(v).trim().length >= 2 || "Nome muito curto",
            })}
            placeholder="Nome completo"
          />
        </FormField>

        <FormField
          form={form}
          name={`${prefix}.nacionalidade`}
          label="Nacionalidade"
        >
          <Input
            {...form.register(`${prefix}.nacionalidade`)}
            placeholder="Brasileiro(a)"
          />
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
              onChange: (e) =>
                form.setValue(`${prefix}.cpf`, maskCPF(e.target.value), { shouldDirty: true }),
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
            {...form.register(`${prefix}.data_nascimento`)}
            type="date"
            placeholder="YYYY-MM-DD"
          />
        </FormField>

        <FormField form={form} name={`${prefix}.sexo`} label="Sexo">
          <NativeSelect
            value={form.watch(`${prefix}.sexo`) || ""}
            onChange={(v) => form.setValue(`${prefix}.sexo`, v, { shouldDirty: true })}
            options={[
              { value: "", label: "Não informado" },
              { value: "M", label: "Masculino" },
              { value: "F", label: "Feminino" },
            ]}
          />
        </FormField>

        <FormField
          form={form}
          name={`${prefix}.nome_mae`}
          label="Nome da Mãe"
          className="md:col-span-2"
        >
          <Input
            {...form.register(`${prefix}.nome_mae`)}
            placeholder="Nome completo da mãe (exigido pela certidão cível TJSP)"
          />
        </FormField>

        <FormField form={form} name={`${prefix}.email`} label="Email">
          <Input
            {...form.register(`${prefix}.email`)}
            type="email"
            placeholder="email@exemplo.com"
          />
        </FormField>

        <FormField
          form={form}
          name={`${prefix}.mobile_phone`}
          label="Celular (com DDD)"
        >
          <Input
            {...form.register(`${prefix}.mobile_phone`, {
              onChange: (e) =>
                form.setValue(`${prefix}.mobile_phone`, maskTelefone(e.target.value), {
                  shouldDirty: true,
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
              onChange: (e) =>
                form.setValue(`${prefix}.cep`, maskCEP(e.target.value), { shouldDirty: true }),
            })}
            inputMode="numeric"
            placeholder="00000-000"
          />
        </FormField>
      </div>

      {showConjuge && (
        <ConjugeFields form={form} prefix={prefix} />
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`${prefix}-tem-procurador`}
          className="h-4 w-4 rounded border-input accent-primary"
          {...form.register(`${prefix}.tem_procurador`)}
        />
        <Label htmlFor={`${prefix}-tem-procurador`} className="cursor-pointer">
          Possui procurador
        </Label>
      </div>

      {temProcurador && (
        <ProcuradorFields form={form} prefix={prefix} />
      )}

      {/* Phase F.II-δ — "Sou sócio de PJ" — gera DiligentedPerson auto no finalize */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`${prefix}-tem-socio-pj`}
          className="h-4 w-4 rounded border-input accent-primary"
          {...form.register(`${prefix}.tem_socio_pj`)}
        />
        <Label htmlFor={`${prefix}-tem-socio-pj`} className="cursor-pointer">
          Também represento uma pessoa jurídica (será diligenciada automaticamente)
        </Label>
      </div>

      {temSocioPj && (
        <>
          <Separator />
          <p className="text-sm font-semibold text-foreground">Dados da PJ (sócio)</p>
          <p className="text-xs text-muted-foreground -mt-3">
            Certidões da PJ (Cartão CNPJ, CRF FGTS, cível, trabalhista, federal, etc)
            serão extraídas automaticamente quando o formulário for finalizado.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField form={form} name={`${prefix}.socio_pj.cnpj`} label="CNPJ" required>
              <Input
                {...form.register(`${prefix}.socio_pj.cnpj`, {
                  onChange: (e) =>
                    form.setValue(
                      `${prefix}.socio_pj.cnpj`,
                      maskCNPJ(e.target.value),
                      { shouldDirty: true }
                    ),
                })}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
              />
            </FormField>
            <FormField
              form={form}
              name={`${prefix}.socio_pj.razao_social`}
              label="Razão Social"
              required
            >
              <Input
                {...form.register(`${prefix}.socio_pj.razao_social`)}
                placeholder="Empresa X LTDA"
              />
            </FormField>
            <FormField form={form} name={`${prefix}.socio_pj.uf`} label="UF">
              <UFSelect
                value={form.watch(`${prefix}.socio_pj.uf`)}
                onChange={(v) => form.setValue(`${prefix}.socio_pj.uf`, v, { shouldDirty: true })}
              />
            </FormField>
            <FormField
              form={form}
              name={`${prefix}.socio_pj.cidade`}
              label="Cidade"
            >
              <Input
                {...form.register(`${prefix}.socio_pj.cidade`)}
                placeholder="Cidade"
              />
            </FormField>
          </div>
        </>
      )}
    </div>
  );
}

function PessoaJuridicaFields({
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
          label="Razao Social"
          className="md:col-span-2"
        >
          <Input
            {...form.register(`${prefix}.razao_social`)}
            placeholder="Razao Social da empresa"
          />
        </FormField>

        <FormField form={form} name={`${prefix}.cnpj`} label="CNPJ">
          <Input
            {...form.register(`${prefix}.cnpj`, {
              onChange: (e) =>
                form.setValue(`${prefix}.cnpj`, maskCNPJ(e.target.value), { shouldDirty: true }),
            })}
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
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
              onChange: (e) =>
                form.setValue(`${prefix}.cep`, maskCEP(e.target.value), { shouldDirty: true }),
            })}
            inputMode="numeric"
            placeholder="00000-000"
          />
        </FormField>
      </div>

      <Separator />
      <p className="text-sm font-semibold text-foreground">Representante Legal</p>
      <RepresentanteFields form={form} prefix={prefix} />
    </div>
  );
}

export function CompradorStep({ form }: CompradorStepProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "compradores",
  });

  const addComprador = () => {
    append({
      tipo_pessoa: "fisica",
      nome: "",
      nacionalidade: "Brasileiro(a)",
      estado_civil: "", // vazio => select mostra "Selecione…"; força escolha (outorga)
      profissao: "",
      rg: "",
      cpf: "",
      email: "",
      endereco: "",
      numero: "",
      complemento: "",
      cidade: "",
      uf: "",
      cep: "",
      tem_procurador: false,
    });
  };

  return (
    <div className="space-y-4">
      {fields.map((field, index) => {
        const prefix = `compradores.${index}`;
        const tipoPessoa = form.watch(`${prefix}.tipo_pessoa`);

        return (
          <Card key={field.id} className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Comprador {index + 1}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="flex rounded-md border border-input overflow-hidden">
                    <button
                      type="button"
                      onClick={() =>
                        form.setValue(`${prefix}.tipo_pessoa`, "fisica", { shouldDirty: true })
                      }
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        tipoPessoa === "fisica"
                          ? "bg-primary text-primary-foreground"
                          : "bg-transparent text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pessoa Fisica
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        form.setValue(`${prefix}.tipo_pessoa`, "juridica", { shouldDirty: true })
                      }
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        tipoPessoa === "juridica"
                          ? "bg-primary text-primary-foreground"
                          : "bg-transparent text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Pessoa Juridica
                    </button>
                  </div>
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // H.17 (Phase H, 2026-04-18) — confirma antes de
                        // remover se o slot tem dados preenchidos (evita
                        // perda silenciosa de OCR-extraídos ao deletar dup).
                        const current = form.getValues(
                          `compradores.${index}` as never
                        ) as Record<string, unknown> | undefined;
                        const hasData = !!(
                          current &&
                          (current.nome ||
                            current.cpf ||
                            current.cnpj ||
                            current.data_nascimento)
                        );
                        if (
                          hasData &&
                          !window.confirm(
                            "Este comprador tem dados preenchidos (possivelmente extraídos por OCR). Remover?"
                          )
                        ) {
                          return;
                        }
                        remove(index);
                      }}
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
                <PessoaJuridicaFields form={form} prefix={prefix} />
              ) : (
                <PessoaFisicaFields form={form} prefix={prefix} />
              )}
            </CardContent>
          </Card>
        );
      })}

      <Button
        type="button"
        variant="outline"
        onClick={addComprador}
        className="w-full border-dashed"
      >
        + Adicionar Comprador
      </Button>
    </div>
  );
}
