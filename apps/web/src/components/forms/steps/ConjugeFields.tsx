"use client";

import { useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { getByPath } from "@/lib/forms/party-required";

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

interface ConjugeFieldsProps {
  form: UseFormReturn<any>;
  /**
   * Path prefix do titular, ex: "vendedores.0", "locadores.1" ou
   * "garantia.fiador" — o sub-obj `conjuge` é apenso. Também é por onde os
   * erros são lidos, então o componente serve qualquer lista (e o fiador de
   * locação, que não é array e não tem índice).
   */
  prefix: string;
  /**
   * "venda" (default) mostra os campos que as certidões PF exigem
   * (nome da mãe, sexo, naturalidade). "locacao" os omite — lá não há
   * diligência de certidão sobre o cônjuge, e o titular também não os pede.
   */
  variant?: "venda" | "locacao";
}

/**
 * Bloco de cônjuge espelhando os campos do titular (PF). Inclui flag
 * "Mora no mesmo endereço do titular" — quando ligado (default), endereço do
 * cônjuge é lido do titular pelo helper getEnderecoEfetivo. Quando desligado,
 * inputs de endereço aparecem.
 */
export function ConjugeFields({
  form,
  prefix,
  variant = "venda",
}: ConjugeFieldsProps) {
  const enderecoIgual = form.watch(`${prefix}.conjuge.endereco_igual_ao_titular`);

  // Default true — se o flag nunca foi tocado (legacy data ou primeiro render),
  // assume que cônjuge mora junto. Evita inputs de endereço aparecerem
  // do nada e atrapalha autofill do OCR.
  useEffect(() => {
    if (enderecoIgual === undefined) {
      form.setValue(
        `${prefix}.conjuge.endereco_igual_ao_titular`,
        true as never,
        { shouldDirty: false }
      );
    }
  }, [enderecoIgual, form, prefix]);

  const showEnderecoFields = enderecoIgual === false;
  const showCertidaoFields = variant === "venda";
  const errors = getByPath(form.formState.errors, `${prefix}.conjuge`) as
    | Record<string, { message?: string }>
    | undefined;

  return (
    <>
      <Separator />
      <p className="text-sm font-semibold text-foreground">
        Dados do Cônjuge <span className="text-destructive">*</span>
      </p>
      <p className="text-xs text-muted-foreground -mt-3">
        Obrigatórios quando o estado civil é Casado(a) ou União Estável — sem
        nome e CPF do cônjuge o contrato não avança. Informe também o e-mail se
        ele for assinar.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Nome do Cônjuge *" className="md:col-span-2">
          <Input
            {...form.register(`${prefix}.conjuge.nome`)}
            placeholder="Nome completo do cônjuge"
          />
          <FieldError error={errors?.nome} />
        </FormField>
        <FormField label="CPF do Cônjuge *">
          <Input
            {...form.register(`${prefix}.conjuge.cpf`)}
            placeholder="000.000.000-00"
          />
          <FieldError error={errors?.cpf} />
        </FormField>
        <FormField label="RG do Cônjuge">
          <Input {...form.register(`${prefix}.conjuge.rg`)} placeholder="RG" />
        </FormField>
        <FormField label="Data de Nascimento do Cônjuge">
          <Input
            {...form.register(`${prefix}.conjuge.data_nascimento`)}
            type="date"
          />
        </FormField>
        {showCertidaoFields && (
          <>
            <FormField label="Sexo do Cônjuge">
              <NativeSelect
                value={form.watch(`${prefix}.conjuge.sexo`) || ""}
                onChange={(v) =>
                  form.setValue(`${prefix}.conjuge.sexo`, v, { shouldDirty: true })
                }
                options={[
                  { value: "", label: "Não informado" },
                  { value: "M", label: "Masculino" },
                  { value: "F", label: "Feminino" },
                ]}
              />
            </FormField>
            <FormField label="Nome da Mãe do Cônjuge" className="md:col-span-2">
              <Input
                {...form.register(`${prefix}.conjuge.nome_mae`)}
                placeholder="Exigido pelas certidões PF (TJSP, PGFN, Antecedentes)"
              />
            </FormField>
          </>
        )}
        <FormField label="Nacionalidade do Cônjuge">
          <Input
            {...form.register(`${prefix}.conjuge.nacionalidade`)}
            placeholder="Brasileiro(a)"
          />
        </FormField>
        {showCertidaoFields && (
          <FormField label="Naturalidade do Cônjuge">
            <Input
              {...form.register(`${prefix}.conjuge.naturalidade`)}
              placeholder="Cidade/UF de nascimento"
            />
          </FormField>
        )}
        <FormField label="Profissão do Cônjuge">
          <Input
            {...form.register(`${prefix}.conjuge.profissao`)}
            placeholder="Profissão"
          />
        </FormField>
        <FormField label="Email do Cônjuge">
          <Input
            {...form.register(`${prefix}.conjuge.email`)}
            type="email"
            placeholder="email@exemplo.com"
          />
        </FormField>
        <FormField label="Celular do Cônjuge (com DDD)">
          <Input
            {...form.register(`${prefix}.conjuge.mobile_phone`)}
            type="tel"
            placeholder="(11) 99999-9999"
          />
        </FormField>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id={`${prefix}-conjuge-end-igual`}
          className="h-4 w-4 rounded border-input accent-primary"
          checked={enderecoIgual !== false}
          onChange={(e) =>
            form.setValue(
              `${prefix}.conjuge.endereco_igual_ao_titular`,
              e.target.checked as never,
              { shouldDirty: true }
            )
          }
        />
        <Label
          htmlFor={`${prefix}-conjuge-end-igual`}
          className="cursor-pointer text-sm"
        >
          Mora no mesmo endereço do titular
        </Label>
      </div>

      {showEnderecoFields && (
        <>
          <p className="text-sm font-semibold text-foreground pt-1">
            Endereço do Cônjuge
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Logradouro" className="md:col-span-2">
              <Input
                {...form.register(`${prefix}.conjuge.endereco`)}
                placeholder="Rua, Avenida..."
              />
            </FormField>
            <FormField label="Número">
              <Input
                {...form.register(`${prefix}.conjuge.numero`)}
                placeholder="123"
              />
            </FormField>
            <FormField label="Complemento">
              <Input
                {...form.register(`${prefix}.conjuge.complemento`)}
                placeholder="Apto, Sala..."
              />
            </FormField>
            <FormField label="Bairro">
              <Input
                {...form.register(`${prefix}.conjuge.bairro`)}
                placeholder="Bairro"
              />
            </FormField>
            <FormField label="Cidade">
              <Input
                {...form.register(`${prefix}.conjuge.cidade`)}
                placeholder="Cidade"
              />
            </FormField>
            <FormField label="UF">
              <UFSelect
                value={form.watch(`${prefix}.conjuge.uf`)}
                onChange={(v) =>
                  form.setValue(`${prefix}.conjuge.uf`, v, { shouldDirty: true })
                }
              />
            </FormField>
            <FormField label="CEP">
              <Input
                {...form.register(`${prefix}.conjuge.cep`)}
                placeholder="00000-000"
              />
            </FormField>
          </div>
        </>
      )}
    </>
  );
}
