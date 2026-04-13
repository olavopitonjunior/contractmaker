"use client";

import { useFieldArray, UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { NativeSelect } from "@/components/forms/NativeSelect";

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
          <FieldError error={(form.formState.errors?.compradores as any)?.[index]?.nome} />
        </FormField>

        <FormField label="Nacionalidade">
          <Input
            {...form.register(`${prefix}.nacionalidade`)}
            placeholder="Brasileiro(a)"
          />
        </FormField>

        <FormField label="Estado Civil">
          <NativeSelect
            value={form.watch(`${prefix}.estado_civil`) || "Solteiro(a)"}
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
          <Input {...form.register(`${prefix}.cpf`)} placeholder="000.000.000-00" />
        </FormField>

        <FormField label="Email" className="md:col-span-2">
          <Input
            {...form.register(`${prefix}.email`)}
            type="email"
            placeholder="email@exemplo.com"
          />
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
          <Input {...form.register(`${prefix}.cep`)} placeholder="00000-000" />
        </FormField>
      </div>

      {showConjuge && (
        <>
          <Separator />
          <p className="text-sm font-semibold text-foreground">Dados do Cônjuge</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Nome do Cônjuge" className="md:col-span-2">
              <Input
                {...form.register(`${prefix}.conjuge.nome`)}
                placeholder="Nome completo do conjuge"
              />
            </FormField>
            <FormField label="CPF do Cônjuge">
              <Input
                {...form.register(`${prefix}.conjuge.cpf`)}
                placeholder="000.000.000-00"
              />
            </FormField>
            <FormField label="RG do Cônjuge">
              <Input {...form.register(`${prefix}.conjuge.rg`)} placeholder="RG" />
            </FormField>
            <FormField label="Nacionalidade do Cônjuge">
              <Input
                {...form.register(`${prefix}.conjuge.nacionalidade`)}
                placeholder="Brasileiro(a)"
              />
            </FormField>
            <FormField label="Profissão do Cônjuge">
              <Input
                {...form.register(`${prefix}.conjuge.profissao`)}
                placeholder="Profissão"
              />
            </FormField>
          </div>
        </>
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
        <>
          <Separator />
          <p className="text-sm font-semibold text-foreground">Dados do Procurador</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Nome do Procurador" className="md:col-span-2">
              <Input
                {...form.register(`${prefix}.procurador.nome`)}
                placeholder="Nome completo"
              />
            </FormField>
            <FormField label="CPF do Procurador">
              <Input
                {...form.register(`${prefix}.procurador.cpf`)}
                placeholder="000.000.000-00"
              />
            </FormField>
            <FormField label="RG do Procurador">
              <Input {...form.register(`${prefix}.procurador.rg`)} placeholder="RG" />
            </FormField>
            <FormField label="Endereço do Procurador" className="md:col-span-2">
              <Input
                {...form.register(`${prefix}.procurador.endereco`)}
                placeholder="Logradouro"
              />
            </FormField>
            <FormField label="Número">
              <Input
                {...form.register(`${prefix}.procurador.numero`)}
                placeholder="123"
              />
            </FormField>
            <FormField label="Cidade">
              <Input
                {...form.register(`${prefix}.procurador.cidade`)}
                placeholder="Cidade"
              />
            </FormField>
            <FormField label="UF">
              <UFSelect
                value={form.watch(`${prefix}.procurador.uf`)}
                onChange={(v) => form.setValue(`${prefix}.procurador.uf`, v, { shouldDirty: true })}
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
        <FormField label="Razao Social *" className="md:col-span-2">
          <Input
            {...form.register(`${prefix}.razao_social`)}
            placeholder="Razao Social da empresa"
          />
        </FormField>

        <FormField label="CNPJ">
          <Input {...form.register(`${prefix}.cnpj`)} placeholder="00.000.000/0000-00" />
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
          <Input {...form.register(`${prefix}.cep`)} placeholder="00000-000" />
        </FormField>
      </div>

      <Separator />
      <p className="text-sm font-semibold text-foreground">Representante Legal</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Nome do Representante" className="md:col-span-2">
          <Input
            {...form.register(`${prefix}.representante.nome`)}
            placeholder="Nome completo"
          />
        </FormField>
        <FormField label="CPF do Representante">
          <Input
            {...form.register(`${prefix}.representante.cpf`)}
            placeholder="000.000.000-00"
          />
        </FormField>
        <FormField label="Nacionalidade">
          <Input
            {...form.register(`${prefix}.representante.nacionalidade`)}
            placeholder="Brasileiro(a)"
          />
        </FormField>
        <FormField label="Estado Civil">
          <NativeSelect
            value={form.watch(`${prefix}.representante.estado_civil`) || ""}
            onChange={(v) =>
              form.setValue(`${prefix}.representante.estado_civil`, v, { shouldDirty: true })
            }
            options={ESTADOS_CIVIS.map((ec) => ({ value: ec, label: ec }))}
            placeholder="Selecione"
          />
        </FormField>
        <FormField label="Profissão">
          <Input
            {...form.register(`${prefix}.representante.profissao`)}
            placeholder="Profissão"
          />
        </FormField>
      </div>
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
      estado_civil: "Solteiro(a)",
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
        onClick={addComprador}
        className="w-full border-dashed"
      >
        + Adicionar Comprador
      </Button>
    </div>
  );
}
