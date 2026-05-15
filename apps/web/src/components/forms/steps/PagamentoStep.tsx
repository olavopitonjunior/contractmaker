"use client";

import {
  useFieldArray,
  UseFormReturn,
  useWatch,
  Controller,
} from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { Trash2, Plus } from "lucide-react";
import {
  TIPO_LABELS,
  MOMENTO_LABELS,
  MEIO_LABELS,
  PIX_TIPO_CHAVE_LABELS,
  TIPO_CONTA_LABELS,
  BANCO_FINANCIAMENTO_LABELS,
  toOptions,
} from "@/lib/forms/payment-labels";

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

// Opções pros selects — fonte canônica em lib/forms/payment-labels.ts.
// Esse módulo compartilhado é importado também pelo enrichContractData
// pra garantir que o texto canônico no contrato bate com o que o user
// selecionou no form (label = label).
const TIPO_OPTIONS = toOptions(TIPO_LABELS);
const MOMENTO_OPTIONS = toOptions(MOMENTO_LABELS);
// MEIO_LABELS inclui um valor legado "transferencia" pra retrocompat de Zod;
// o select da UI lista só os modernos (mesma ordem do enum original).
const MEIO_OPTIONS = (
  ["pix", "ted", "boleto", "dinheiro", "cheque", "financiamento", "fgts_saque", "permuta"] as const
).map((k) => ({ value: k, label: MEIO_LABELS[k] }));
const PIX_TIPO_CHAVE_OPTIONS = toOptions(PIX_TIPO_CHAVE_LABELS);
const TIPO_CONTA_OPTIONS = toOptions(TIPO_CONTA_LABELS);
const BANCO_FINANCIAMENTO_OPTIONS = toOptions(BANCO_FINANCIAMENTO_LABELS);

function ParcelaCard({
  index,
  form,
  onRemove,
}: {
  index: number;
  form: UseFormReturn<any>;
  onRemove: () => void;
}) {
  const base = `pagamento.parcelas.${index}`;
  const tipo = form.watch(`${base}.tipo`);
  const momento = form.watch(`${base}.momento`);
  const meio = form.watch(`${base}.meio_pagamento`);

  const showTipoOutros = tipo === "outros";
  const showPermutaDesc = tipo === "permuta_veiculo" || tipo === "permuta_imovel";
  const showDias = momento === "dias";
  const showDataExata = momento === "data_exata";
  const showPix = meio === "pix";
  const showBancarios = meio === "ted";
  const showBancoFinanciamento = meio === "financiamento";

  return (
    <div className="rounded-md border p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Parcela {index + 1}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Remover
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Tipo">
          <NativeSelect
            value={tipo || ""}
            onChange={(v) =>
              form.setValue(`${base}.tipo`, v, { shouldDirty: true })
            }
            options={[{ value: "", label: "Selecione..." }, ...TIPO_OPTIONS]}
          />
        </FormField>

        <FormField label="Valor">
          <ControlledMoney name={`${base}.valor`} form={form} />
        </FormField>

        {showTipoOutros && (
          <FormField label="Especificar tipo" className="md:col-span-2">
            <Input
              {...form.register(`${base}.tipo_outros_texto`)}
              placeholder="Descreva o tipo de pagamento..."
            />
          </FormField>
        )}

        {showPermutaDesc && (
          <FormField label="Descrição da permuta" className="md:col-span-2">
            <textarea
              {...form.register(`${base}.permuta_descricao`)}
              placeholder={
                tipo === "permuta_veiculo"
                  ? "Ex: Veículo Honda Civic 2022, placa ABC1234..."
                  : "Ex: Apartamento na Rua X, matrícula nº 12345..."
              }
              rows={2}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring resize-none"
            />
          </FormField>
        )}

        <FormField label="Quando">
          <NativeSelect
            value={momento || "assinatura"}
            onChange={(v) =>
              form.setValue(`${base}.momento`, v, { shouldDirty: true })
            }
            options={MOMENTO_OPTIONS}
          />
        </FormField>

        {showDias && (
          <FormField label="Dias após a assinatura">
            <Input
              type="number"
              min="0"
              {...form.register(`${base}.dias`, { valueAsNumber: true })}
              placeholder="Ex: 30"
            />
          </FormField>
        )}

        {showDataExata && (
          <FormField label="Data específica">
            <Input
              type="date"
              {...form.register(`${base}.data_exata`)}
            />
          </FormField>
        )}

        <FormField label="Meio de pagamento" className="md:col-span-2">
          <NativeSelect
            value={meio || ""}
            onChange={(v) =>
              form.setValue(`${base}.meio_pagamento`, v, { shouldDirty: true })
            }
            options={[{ value: "", label: "Selecione..." }, ...MEIO_OPTIONS]}
          />
        </FormField>

        {showPix && (
          <div className="md:col-span-2 rounded-md border border-dashed bg-background p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Dados do PIX (vendedor recebe nesta chave)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormField label="Tipo de chave">
                <NativeSelect
                  value={form.watch(`${base}.pix.tipo_chave`) || ""}
                  onChange={(v) =>
                    form.setValue(`${base}.pix.tipo_chave`, v, {
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
                  {...form.register(`${base}.pix.chave`)}
                  placeholder="CPF, CNPJ, email, telefone ou EVP"
                />
              </FormField>
              <FormField label="Titular (nome)">
                <Input
                  {...form.register(`${base}.pix.titular_nome`)}
                  placeholder="Nome do titular da chave"
                />
              </FormField>
              <FormField label="CPF/CNPJ do titular">
                <Input
                  {...form.register(`${base}.pix.titular_cpf_cnpj`)}
                  placeholder="000.000.000-00"
                />
              </FormField>
            </div>
          </div>
        )}

        {showBancarios && (
          <div className="md:col-span-2 rounded-md border border-dashed bg-background p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Dados bancários (vendedor recebe nesta conta)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <FormField label="Banco">
                <Input
                  {...form.register(`${base}.bancarios.banco`)}
                  placeholder="Ex: Itaú"
                />
              </FormField>
              <FormField label="Agência">
                <Input
                  {...form.register(`${base}.bancarios.agencia`)}
                  placeholder="0001"
                />
              </FormField>
              <FormField label="Conta">
                <Input
                  {...form.register(`${base}.bancarios.conta`)}
                  placeholder="12345-6"
                />
              </FormField>
              <FormField label="Tipo de conta">
                <NativeSelect
                  value={form.watch(`${base}.bancarios.tipo_conta`) || "corrente"}
                  onChange={(v) =>
                    form.setValue(`${base}.bancarios.tipo_conta`, v, {
                      shouldDirty: true,
                    })
                  }
                  options={TIPO_CONTA_OPTIONS}
                />
              </FormField>
              <FormField label="Titular (nome)">
                <Input
                  {...form.register(`${base}.bancarios.titular_nome`)}
                  placeholder="Nome do titular"
                />
              </FormField>
              <FormField label="CPF/CNPJ do titular">
                <Input
                  {...form.register(`${base}.bancarios.titular_cpf_cnpj`)}
                  placeholder="000.000.000-00"
                />
              </FormField>
            </div>
          </div>
        )}

        {showBancoFinanciamento && (
          <FormField label="Banco do financiamento" className="md:col-span-2">
            <NativeSelect
              value={form.watch(`${base}.banco_financiamento`) || ""}
              onChange={(v) =>
                form.setValue(`${base}.banco_financiamento`, v, {
                  shouldDirty: true,
                })
              }
              options={[
                { value: "", label: "Selecione o banco..." },
                ...BANCO_FINANCIAMENTO_OPTIONS,
              ]}
            />
          </FormField>
        )}
      </div>
    </div>
  );
}

export function PagamentoStep({ form }: PagamentoStepProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "pagamento.parcelas",
  });

  const addParcela = () => {
    append({
      tipo_texto: "",
      dias: 0,
      valor: 0,
      tipo: "",
      momento: "assinatura",
      meio_pagamento: "",
    });
  };

  const pagamento = useWatch({
    control: form.control,
    name: "pagamento",
  }) as
    | {
        valor_total?: number;
        parcelas?: Array<{ valor?: number }>;
      }
    | undefined;

  const valorTotal = Number(pagamento?.valor_total || 0);
  const somaParcelas = (pagamento?.parcelas ?? []).reduce(
    (acc, p) => acc + Number(p?.valor || 0),
    0
  );

  const diferenca = valorTotal - somaParcelas;
  const bate = Math.abs(diferenca) < 0.01;
  const hasValue = valorTotal > 0 || somaParcelas > 0;

  return (
    <div className="space-y-4">
      {/* Valor Total */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Valor Total da Venda
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="Valor total ajustado">
            <ControlledMoney name="pagamento.valor_total" form={form} />
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
              cronograma de pagamento (sinal, financiamento, FGTS, etc).
            </p>
          )}

          {fields.map((field, index) => (
            <ParcelaCard
              key={field.id}
              index={index}
              form={form}
              onRemove={() => remove(index)}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={addParcela}
            className="w-full border-dashed"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Adicionar Parcela
          </Button>

          {hasValue && (
            <div
              className={`sticky bottom-0 rounded-md border p-3 text-sm ${
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
