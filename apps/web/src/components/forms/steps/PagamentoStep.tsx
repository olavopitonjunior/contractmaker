"use client";

import { useFieldArray, UseFormReturn, useWatch, Controller } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { NativeSelect } from "@/components/forms/NativeSelect";

interface PagamentoStepProps {
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

function ControlledMoney({
  name,
  form,
}: {
  name: string;
  form: UseFormReturn<any>;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <MoneyInput
          value={field.value || 0}
          onChange={(v) => field.onChange(v)}
        />
      )}
    />
  );
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function PagamentoStep({ form }: PagamentoStepProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "pagamento.parcelas",
  });

  const addParcela = () => {
    append({ tipo_texto: "", dias: 0, valor: 0 });
  };

  // Soma das parcelas para validacao visual
  const pagamento = useWatch({
    control: form.control,
    name: "pagamento",
  }) as
    | {
        valor_total?: number;
        sinal_arras?: number;
        recursos_proprios?: number;
        fgts?: number;
        cessao_consorcio?: number;
        alienacao_fiduciaria?: number;
        outras_formas?: number;
      }
    | undefined;

  const valorTotal = Number(pagamento?.valor_total || 0);
  const somaParcelas =
    Number(pagamento?.sinal_arras || 0) +
    Number(pagamento?.recursos_proprios || 0) +
    Number(pagamento?.fgts || 0) +
    Number(pagamento?.cessao_consorcio || 0) +
    Number(pagamento?.alienacao_fiduciaria || 0) +
    Number(pagamento?.outras_formas || 0);

  const diferenca = valorTotal - somaParcelas;
  const bate = Math.abs(diferenca) < 0.01;
  const hasValue = valorTotal > 0 || somaParcelas > 0;

  return (
    <div className="space-y-4">
      {/* Valores */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Valores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Valor Total da Venda" className="md:col-span-2">
              <ControlledMoney name="pagamento.valor_total" form={form} />
            </FormField>

            <FormField label="Sinal / Arras">
              <ControlledMoney name="pagamento.sinal_arras" form={form} />
            </FormField>

            <FormField label="Recursos Próprios">
              <ControlledMoney name="pagamento.recursos_proprios" form={form} />
            </FormField>

            <FormField label="FGTS">
              <ControlledMoney name="pagamento.fgts" form={form} />
            </FormField>

            <FormField label="Cessão de Consórcio">
              <ControlledMoney name="pagamento.cessao_consorcio" form={form} />
            </FormField>

            <FormField label="Alienação Fiduciária / Financiamento">
              <ControlledMoney
                name="pagamento.alienacao_fiduciaria"
                form={form}
              />
            </FormField>

            <FormField label="Outras Formas de Pagamento">
              <ControlledMoney name="pagamento.outras_formas" form={form} />
            </FormField>
          </div>

          {hasValue && (
            <div
              className={`rounded-md border p-3 text-sm ${
                bate
                  ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400"
                  : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span>
                  Soma das parcelas:{" "}
                  <strong>{formatBRL(somaParcelas)}</strong>
                </span>
                <span>
                  Valor total: <strong>{formatBRL(valorTotal)}</strong>
                </span>
              </div>
              {!bate && (
                <p className="mt-1 text-xs">
                  {diferenca > 0
                    ? `Faltam ${formatBRL(diferenca)} para fechar o valor total.`
                    : `As parcelas somam ${formatBRL(
                        Math.abs(diferenca)
                      )} a mais que o valor total.`}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meio de Pagamento */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Meio de Pagamento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="Forma de Pagamento Principal">
            <NativeSelect
              className="w-full md:w-80"
              value={form.watch("pagamento.meio_pagamento") || "transferencia bancaria"}
              onChange={(v) => form.setValue("pagamento.meio_pagamento", v, { shouldDirty: true })}
              options={[
                { value: "transferencia bancaria", label: "Transferência Bancária (TED/PIX)" },
                { value: "cheque", label: "Cheque" },
                { value: "dinheiro", label: "Dinheiro (Espécie)" },
                { value: "financiamento bancario", label: "Financiamento Bancário" },
                { value: "permuta", label: "Permuta" },
                { value: "misto", label: "Misto" },
              ]}
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Parcelas */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Parcelas / Cronograma de Pagamento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma parcela adicionada. Clique abaixo para adicionar o
              cronograma de pagamento.
            </p>
          )}

          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-1 md:grid-cols-[1fr_100px_180px_auto] gap-3 items-end p-3 rounded-md border border-border bg-muted/30"
            >
              <FormField label={`Parcela ${index + 1} - Descrição`}>
                <Input
                  {...form.register(`pagamento.parcelas.${index}.tipo_texto`)}
                  placeholder="Ex: Sinal na assinatura, 1ª parcela..."
                />
              </FormField>

              <FormField label="Dias">
                <Input
                  type="number"
                  min="0"
                  {...form.register(`pagamento.parcelas.${index}.dias`, {
                    valueAsNumber: true,
                  })}
                  placeholder="0"
                />
              </FormField>

              <FormField label="Valor">
                <ControlledMoney
                  name={`pagamento.parcelas.${index}.valor`}
                  form={form}
                />
              </FormField>

              <div className="flex items-end pb-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => remove(index)}
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  Remover
                </Button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={addParcela}
            className="w-full border-dashed"
          >
            + Adicionar Parcela
          </Button>
        </CardContent>
      </Card>

      {/* Incluso no Preço */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Incluso no Preço
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="O que está incluso no preço de venda">
            <textarea
              {...form.register("incluso_no_preco")}
              placeholder="Ex: móveis planejados, eletrodomésticos, vaga de garagem..."
              rows={4}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </FormField>
        </CardContent>
      </Card>
    </div>
  );
}
