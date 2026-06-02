"use client";

import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { FormField } from "./_PartyFields";

const INDICE_OPTIONS = [
  { value: "IGPM", label: "IGP-M (FGV)" },
  { value: "IPCA", label: "IPCA (IBGE)" },
  { value: "outro", label: "Outro" },
];

const MEIO_PAGAMENTO_OPTIONS = [
  { value: "pix", label: "PIX" },
  { value: "boleto", label: "Boleto bancário" },
  { value: "qualquer", label: "Qualquer" },
];

const DIA_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `Dia ${i + 1}`,
}));

/**
 * Aluguel & reajuste (aluguelSchema). A taxa de administração e os campos
 * fiscais (regime IR, repasse, NFS-e) NÃO aparecem aqui — são definidos pelo
 * operador no diálogo de criação do formulário.
 */
export function AluguelStep({ form }: { form: UseFormReturn<any> }) {
  return (
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Aluguel e reajuste</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Valor do aluguel (R$) *">
            <Input
              {...form.register("aluguel.valor", { valueAsNumber: true })}
              type="number"
              inputMode="decimal"
              placeholder="0,00"
            />
          </FormField>
          <FormField label="Encargos mensais (IPTU/condomínio) (R$)">
            <Input
              {...form.register("aluguel.encargos", { valueAsNumber: true })}
              type="number"
              inputMode="decimal"
              placeholder="0,00"
            />
          </FormField>
          <FormField label="Dia de vencimento">
            <NativeSelect
              value={String(form.watch("aluguel.dia_vencimento") || 10)}
              onChange={(v) =>
                form.setValue("aluguel.dia_vencimento", Number(v), { shouldDirty: true })
              }
              options={DIA_OPTIONS}
            />
          </FormField>
          <FormField label="Forma de pagamento">
            <NativeSelect
              value={form.watch("aluguel.meio_pagamento") || "pix"}
              onChange={(v) => form.setValue("aluguel.meio_pagamento", v, { shouldDirty: true })}
              options={MEIO_PAGAMENTO_OPTIONS}
            />
          </FormField>
          <FormField label="Índice de reajuste">
            <NativeSelect
              value={form.watch("aluguel.indice_reajuste") || "IGPM"}
              onChange={(v) => form.setValue("aluguel.indice_reajuste", v, { shouldDirty: true })}
              options={INDICE_OPTIONS}
            />
          </FormField>
          <FormField label="Início da vigência">
            <Input {...form.register("aluguel.vigencia_inicio")} type="date" />
          </FormField>
          <FormField label="Prazo (meses)">
            <Input
              {...form.register("aluguel.vigencia_meses", { valueAsNumber: true })}
              type="number"
              inputMode="numeric"
              placeholder="30"
            />
          </FormField>
        </div>
      </CardContent>
    </Card>
  );
}
