"use client";

import { useFieldArray, UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { ConjugeFields } from "@/components/forms/steps/ConjugeFields";
import { ProcuradorFields } from "@/components/forms/steps/ProcuradorFields";
import { RepresentanteFields } from "@/components/forms/steps/RepresentanteFields";
import {
  PIX_TIPO_CHAVE_LABELS,
  TIPO_CONTA_LABELS,
  toOptions,
} from "@/lib/forms/payment-labels";
import { maskCPF, maskCNPJ, maskCEP, maskTelefone } from "@/lib/forms/field-formats";

const PIX_TIPO_CHAVE_OPTIONS = toOptions(PIX_TIPO_CHAVE_LABELS);
const TIPO_CONTA_OPTIONS = toOptions(TIPO_CONTA_LABELS);

interface VendedorStepProps {
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

function FieldError({ error }: { error?: { message?: string } }) {
  if (!error?.message) return null;
  return <p className="text-xs text-destructive mt-1">{error.message}</p>;
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

/**
 * Dados de recebimento do vendedor (PIX + conta bancária).
 * Migrado em 2026-05-16 de pagamento.parcelas[].pix/bancarios pra cá —
 * é dado do vendedor (uma vez), não da parcela individual.
 * Usado por PessoaFisicaFields e PessoaJuridicaFields.
 */
function RecebimentoFields({
  form,
  prefix,
}: {
  form: UseFormReturn<any>;
  prefix: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Conta/PIX onde o vendedor recebe os pagamentos do comprador. Opcional —
        pode ser informado depois.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Tipo de chave PIX">
          <NativeSelect
            value={form.watch(`${prefix}.recebimento.pix_tipo_chave`) || ""}
            onChange={(v) =>
              form.setValue(`${prefix}.recebimento.pix_tipo_chave`, v, {
                shouldDirty: true,
              })
            }
            options={[
              { value: "", label: "Selecione..." },
              ...PIX_TIPO_CHAVE_OPTIONS,
            ]}
          />
        </FormField>
        <FormField label="Chave PIX">
          <Input
            {...form.register(`${prefix}.recebimento.pix_chave`)}
            placeholder="CPF, CNPJ, email, telefone ou EVP"
          />
        </FormField>
      </div>
      <Separator />
      <p className="text-xs font-semibold text-muted-foreground">
        Conta bancária (TED) — opcional
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField label="Banco">
          <Input
            {...form.register(`${prefix}.recebimento.banco`)}
            placeholder="Ex: Itaú"
          />
        </FormField>
        <FormField label="Agência">
          <Input
            {...form.register(`${prefix}.recebimento.agencia`)}
            placeholder="0001"
          />
        </FormField>
        <FormField label="Conta">
          <Input
            {...form.register(`${prefix}.recebimento.conta`)}
            placeholder="12345-6"
          />
        </FormField>
        <FormField label="Tipo de conta">
          <NativeSelect
            value={form.watch(`${prefix}.recebimento.tipo_conta`) || ""}
            onChange={(v) =>
              form.setValue(`${prefix}.recebimento.tipo_conta`, v, {
                shouldDirty: true,
              })
            }
            options={[
              { value: "", label: "Selecione..." },
              ...TIPO_CONTA_OPTIONS,
            ]}
          />
        </FormField>
      </div>
    </div>
  );
}

function PessoaFisicaFields({
  form,
  index,
  prefix,
}: {
  form: UseFormReturn<any>;
  index: number;
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
        <FormField label="Nome Completo *">
          <Input
            {...form.register(`${prefix}.nome`, {
              required: "Nome é obrigatório",
              minLength: { value: 2, message: "Nome muito curto" },
            })}
            placeholder="Nome completo"
          />
          <FieldError error={(form.formState.errors?.vendedores as any)?.[index]?.nome} />
        </FormField>

        <FormField label="Nacionalidade">
          <Input
            {...form.register(`${prefix}.nacionalidade`)}
            placeholder="Brasileiro(a)"
          />
        </FormField>

        <FormField label="Estado Civil">
          <NativeSelect
            value={form.watch(`${prefix}.estado_civil`) || ""}
            placeholder="Selecione…"
            onChange={(v) => form.setValue(`${prefix}.estado_civil`, v, { shouldDirty: true })}
            options={ESTADOS_CIVIS.map((ec) => ({ value: ec, label: ec }))}
          />
        </FormField>

        <FormField label="Profissão">
          <Input {...form.register(`${prefix}.profissao`)} placeholder="Profissão" />
        </FormField>

        <FormField label="RG">
          <Input {...form.register(`${prefix}.rg`)} placeholder="RG" />
        </FormField>

        <FormField label="CPF">
          <Input
            {...form.register(`${prefix}.cpf`, {
              onChange: (e) =>
                form.setValue(`${prefix}.cpf`, maskCPF(e.target.value), { shouldDirty: true }),
            })}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
          <FieldError error={(form.formState.errors?.vendedores as any)?.[index]?.cpf} />
        </FormField>

        <FormField label="Data de Nascimento">
          <Input
            {...form.register(`${prefix}.data_nascimento`)}
            type="date"
            placeholder="YYYY-MM-DD"
          />
          <FieldError error={(form.formState.errors?.vendedores as any)?.[index]?.data_nascimento} />
        </FormField>

        <FormField label="Sexo">
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

        <FormField label="Nome da Mãe" className="md:col-span-2">
          <Input
            {...form.register(`${prefix}.nome_mae`)}
            placeholder="Nome completo da mãe (exigido pela certidão cível TJSP)"
          />
          <FieldError error={(form.formState.errors?.vendedores as any)?.[index]?.nome_mae} />
        </FormField>

        <FormField label="Email">
          <Input
            {...form.register(`${prefix}.email`)}
            type="email"
            placeholder="email@exemplo.com"
          />
        </FormField>

        <FormField label="Celular (com DDD)">
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
          <FieldError error={(form.formState.errors?.vendedores as any)?.[index]?.mobile_phone} />
        </FormField>
      </div>

      <Separator />

      <p className="text-sm font-semibold text-foreground">Endereço</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Logradouro" className="md:col-span-2">
          <Input {...form.register(`${prefix}.endereco`)} placeholder="Rua, Avenida..." />
        </FormField>

        <FormField label="Número">
          <Input {...form.register(`${prefix}.numero`)} placeholder="123" />
        </FormField>

        <FormField label="Complemento">
          <Input {...form.register(`${prefix}.complemento`)} placeholder="Apto, Sala..." />
        </FormField>

        <FormField label="Bairro">
          <Input {...form.register(`${prefix}.bairro`)} placeholder="Bairro" />
        </FormField>

        <FormField label="Cidade">
          <Input {...form.register(`${prefix}.cidade`)} placeholder="Cidade" />
        </FormField>

        <FormField label="UF">
          <UFSelect
            value={form.watch(`${prefix}.uf`)}
            onChange={(v) => form.setValue(`${prefix}.uf`, v, { shouldDirty: true })}
          />
        </FormField>

        <FormField label="CEP">
          <Input
            {...form.register(`${prefix}.cep`, {
              onChange: (e) =>
                form.setValue(`${prefix}.cep`, maskCEP(e.target.value), { shouldDirty: true }),
            })}
            inputMode="numeric"
            placeholder="00000-000"
          />
          <FieldError error={(form.formState.errors?.vendedores as any)?.[index]?.cep} />
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
            <FormField label="CNPJ *">
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
            <FormField label="Razão Social *">
              <Input
                {...form.register(`${prefix}.socio_pj.razao_social`)}
                placeholder="Empresa X LTDA"
              />
            </FormField>
            <FormField label="UF">
              <UFSelect
                value={form.watch(`${prefix}.socio_pj.uf`)}
                onChange={(v) => form.setValue(`${prefix}.socio_pj.uf`, v, { shouldDirty: true })}
              />
            </FormField>
            <FormField label="Cidade">
              <Input
                {...form.register(`${prefix}.socio_pj.cidade`)}
                placeholder="Cidade"
              />
            </FormField>
          </div>
        </>
      )}

      <Separator />
      <p className="text-sm font-semibold text-foreground">
        Dados de Recebimento
      </p>
      <RecebimentoFields form={form} prefix={prefix} />
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
        <FormField label="Razao Social *" className="md:col-span-2">
          <Input
            {...form.register(`${prefix}.razao_social`)}
            placeholder="Razao Social da empresa"
          />
        </FormField>

        <FormField label="CNPJ">
          <Input
            {...form.register(`${prefix}.cnpj`, {
              onChange: (e) =>
                form.setValue(`${prefix}.cnpj`, maskCNPJ(e.target.value), { shouldDirty: true }),
            })}
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
          />
        </FormField>

        <FormField label="Logradouro" className="md:col-span-2">
          <Input {...form.register(`${prefix}.endereco`)} placeholder="Rua, Avenida..." />
        </FormField>

        <FormField label="Número">
          <Input {...form.register(`${prefix}.numero`)} placeholder="123" />
        </FormField>

        <FormField label="Complemento">
          <Input {...form.register(`${prefix}.complemento`)} placeholder="Sala, Andar..." />
        </FormField>

        <FormField label="Bairro">
          <Input {...form.register(`${prefix}.bairro`)} placeholder="Bairro" />
        </FormField>

        <FormField label="Cidade">
          <Input {...form.register(`${prefix}.cidade`)} placeholder="Cidade" />
        </FormField>

        <FormField label="UF">
          <UFSelect
            value={form.watch(`${prefix}.uf`)}
            onChange={(v) => form.setValue(`${prefix}.uf`, v, { shouldDirty: true })}
          />
        </FormField>

        <FormField label="CEP">
          <Input
            {...form.register(`${prefix}.cep`, {
              onChange: (e) =>
                form.setValue(`${prefix}.cep`, maskCEP(e.target.value), {
                  shouldDirty: true,
                }),
            })}
            inputMode="numeric"
            placeholder="00000-000"
          />
        </FormField>
      </div>

      <Separator />
      <p className="text-sm font-semibold text-foreground">Representante Legal</p>
      <RepresentanteFields form={form} prefix={prefix} />

      <Separator />
      <p className="text-sm font-semibold text-foreground">
        Dados de Recebimento
      </p>
      <RecebimentoFields form={form} prefix={prefix} />
    </div>
  );
}

export function VendedorStep({ form }: VendedorStepProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "vendedores",
  });

  const addVendedor = () => {
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
        const prefix = `vendedores.${index}`;
        const tipoPessoa = form.watch(`${prefix}.tipo_pessoa`);

        return (
          <Card key={field.id} className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Vendedor {index + 1}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="flex rounded-md border border-input overflow-hidden">
                    <button
                      type="button"
                      onClick={() =>
                        form.setValue(`${prefix}.tipo_pessoa`, "fisica")
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
                        form.setValue(`${prefix}.tipo_pessoa`, "juridica")
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
                        // H.17 (Phase H, 2026-04-18) — ver CompradorStep.
                        const current = form.getValues(
                          `vendedores.${index}` as never
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
                            "Este vendedor tem dados preenchidos (possivelmente extraídos por OCR). Remover?"
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
                <PessoaFisicaFields form={form} index={index} prefix={prefix} />
              )}
            </CardContent>
          </Card>
        );
      })}

      <Button
        type="button"
        variant="outline"
        onClick={addVendedor}
        className="w-full border-dashed"
      >
        + Adicionar Vendedor
      </Button>
    </div>
  );
}
