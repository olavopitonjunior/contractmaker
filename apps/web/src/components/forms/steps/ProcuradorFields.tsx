"use client";

import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { maskCPF, maskTelefone } from "@/lib/forms/field-formats";

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

interface ProcuradorFieldsProps {
  form: UseFormReturn<any>;
  index: number;
  /** Path prefix do titular, ex: "vendedores.0" — sub-obj `procurador` é apenso. */
  prefix: string;
  listKey: "vendedores" | "compradores";
}

/**
 * Bloco de procurador (PF). Extraído de VendedorStep/CompradorStep, onde vivia
 * duplicado byte a byte. E-mail e celular foram acrescentados na extração: o
 * schema já os aceitava e `dealDataToSigners` exige e-mail pro procurador
 * assinar, mas não havia campo na tela — ele chegava sempre vazio no envelope.
 */
export function ProcuradorFields({
  form,
  index,
  prefix,
  listKey,
}: ProcuradorFieldsProps) {
  const errors = (form.formState.errors as any)?.[listKey]?.[index]?.procurador;

  return (
    <>
      <Separator />
      <p className="text-sm font-semibold text-foreground">Dados do Procurador</p>
      <p className="text-xs text-muted-foreground -mt-3">
        E-mail e celular são usados para enviar o contrato ao procurador pela
        ClickSign quando ele assina em nome da parte.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Nome do Procurador" className="md:col-span-2">
          <Input
            {...form.register(`${prefix}.procurador.nome`)}
            placeholder="Nome completo"
          />
          <FieldError error={errors?.nome} />
        </FormField>
        <FormField label="CPF do Procurador">
          <Input
            {...form.register(`${prefix}.procurador.cpf`, {
              onChange: (e) =>
                form.setValue(
                  `${prefix}.procurador.cpf`,
                  maskCPF(e.target.value),
                  { shouldDirty: true }
                ),
            })}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
          <FieldError error={errors?.cpf} />
        </FormField>
        <FormField label="RG do Procurador">
          <Input {...form.register(`${prefix}.procurador.rg`)} placeholder="RG" />
        </FormField>
        <FormField label="Sexo do Procurador">
          <NativeSelect
            value={form.watch(`${prefix}.procurador.sexo`) || ""}
            onChange={(v) =>
              form.setValue(`${prefix}.procurador.sexo`, v, { shouldDirty: true })
            }
            options={[
              { value: "", label: "Não informado" },
              { value: "M", label: "Masculino" },
              { value: "F", label: "Feminino" },
            ]}
          />
        </FormField>
        <FormField label="Email do Procurador">
          <Input
            {...form.register(`${prefix}.procurador.email`)}
            type="email"
            placeholder="email@exemplo.com"
          />
          <FieldError error={errors?.email} />
        </FormField>
        <FormField label="Celular do Procurador (com DDD)">
          <Input
            {...form.register(`${prefix}.procurador.mobile_phone`, {
              onChange: (e) =>
                form.setValue(
                  `${prefix}.procurador.mobile_phone`,
                  maskTelefone(e.target.value),
                  { shouldDirty: true }
                ),
            })}
            type="tel"
            inputMode="numeric"
            placeholder="(11) 99999-9999"
          />
          <FieldError error={errors?.mobile_phone} />
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
            onChange={(v) =>
              form.setValue(`${prefix}.procurador.uf`, v, { shouldDirty: true })
            }
          />
        </FormField>
      </div>
    </>
  );
}
