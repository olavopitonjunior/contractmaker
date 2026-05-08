"use client";

import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/forms/NativeSelect";

const ESTADOS_CIVIS = [
  "Solteiro(a)",
  "Casado(a)",
  "Divorciado(a)",
  "Viúvo(a)",
  "União Estável",
  "Separado(a)",
];

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

interface RepresentanteFieldsProps {
  form: UseFormReturn<any>;
  prefix: string;
}

/**
 * Bloco de representante legal de PJ. Campos pessoais espelham titular PF
 * mas sem endereço (representante usa endereço da empresa pra correspondência
 * formal). Inclui rg/data_nascimento/nome_mae — exigidos por PGFN PF e
 * Antecedentes PF do representante quando há diligência.
 */
export function RepresentanteFields({ form, prefix }: RepresentanteFieldsProps) {
  return (
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
      <FormField label="RG do Representante">
        <Input
          {...form.register(`${prefix}.representante.rg`)}
          placeholder="RG"
        />
      </FormField>
      <FormField label="Data de Nascimento">
        <Input
          {...form.register(`${prefix}.representante.data_nascimento`)}
          type="date"
        />
      </FormField>
      <FormField label="Nome da Mãe" className="md:col-span-2">
        <Input
          {...form.register(`${prefix}.representante.nome_mae`)}
          placeholder="Exigido pelas certidões PF do representante"
        />
      </FormField>
      <FormField label="Naturalidade">
        <Input
          {...form.register(`${prefix}.representante.naturalidade`)}
          placeholder="Cidade/UF de nascimento"
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
            form.setValue(`${prefix}.representante.estado_civil`, v, {
              shouldDirty: true,
            })
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
      <FormField label="Email">
        <Input
          {...form.register(`${prefix}.representante.email`)}
          type="email"
          placeholder="email@exemplo.com"
        />
      </FormField>
    </div>
  );
}
