"use client";

import { useFieldArray, UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function CurrencyInput({
  name,
  form,
  placeholder = "0,00",
}: {
  name: string;
  form: UseFormReturn<any>;
  placeholder?: string;
}) {
  return (
    <Input
      type="number"
      step="0.01"
      min="0"
      {...form.register(name, { valueAsNumber: true })}
      placeholder={placeholder}
    />
  );
}

export function PagamentoStep({ form }: PagamentoStepProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "pagamento.parcelas",
  });

  const addParcela = () => {
    append({ tipo_texto: "", dias: 0, valor: 0 });
  };

  return (
    <div className="space-y-4">
      {/* Valores */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Valores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Valor Total da Venda (R$)" className="md:col-span-2">
              <CurrencyInput name="pagamento.valor_total" form={form} />
            </FormField>

            <FormField label="Sinal / Arras (R$)">
              <CurrencyInput name="pagamento.sinal_arras" form={form} />
            </FormField>

            <FormField label="Recursos Proprios (R$)">
              <CurrencyInput name="pagamento.recursos_proprios" form={form} />
            </FormField>

            <FormField label="FGTS (R$)">
              <CurrencyInput name="pagamento.fgts" form={form} />
            </FormField>

            <FormField label="Cessao de Consorcio (R$)">
              <CurrencyInput name="pagamento.cessao_consorcio" form={form} />
            </FormField>

            <FormField label="Alienacao Fiduciaria / Financiamento (R$)">
              <CurrencyInput name="pagamento.alienacao_fiduciaria" form={form} />
            </FormField>

            <FormField label="Outras Formas de Pagamento (R$)">
              <CurrencyInput name="pagamento.outras_formas" form={form} />
            </FormField>
          </div>
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
            <Select
              value={form.watch("pagamento.meio_pagamento") || "transferencia bancaria"}
              onValueChange={(v) => form.setValue("pagamento.meio_pagamento", v)}
            >
              <SelectTrigger className="w-full md:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transferencia bancaria">
                  Transferencia Bancaria (TED/PIX)
                </SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="dinheiro">Dinheiro (Especie)</SelectItem>
                <SelectItem value="financiamento bancario">
                  Financiamento Bancario
                </SelectItem>
                <SelectItem value="permuta">Permuta</SelectItem>
                <SelectItem value="misto">Misto</SelectItem>
              </SelectContent>
            </Select>
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
              className="grid grid-cols-1 md:grid-cols-[1fr_100px_140px_auto] gap-3 items-end p-3 rounded-md border border-border bg-muted/30"
            >
              <FormField label={`Parcela ${index + 1} - Descricao`}>
                <Input
                  {...form.register(`pagamento.parcelas.${index}.tipo_texto`)}
                  placeholder="Ex: Sinal na assinatura, 1a parcela..."
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

              <FormField label="Valor (R$)">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  {...form.register(`pagamento.parcelas.${index}.valor`, {
                    valueAsNumber: true,
                  })}
                  placeholder="0,00"
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

      {/* Incluso no Preco */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Incluso no Preco
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="O que esta incluso no preco de venda">
            <textarea
              {...form.register("incluso_no_preco")}
              placeholder="Ex: moveis planejados, eletrodomesticos, vaga de garagem..."
              rows={4}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </FormField>
        </CardContent>
      </Card>
    </div>
  );
}
