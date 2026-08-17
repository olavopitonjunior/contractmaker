"use client";

import { useEffect, useRef } from "react";
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
  BANCO_FINANCIAMENTO_LABELS,
  toOptions,
} from "@/lib/forms/payment-labels";
import {
  MODALIDADES,
  MODALIDADE_LABELS,
  canReseedSilently,
  deriveModalidadeFromParcelas,
  parcelaRowLabel,
  seedParcelas,
  type Modalidade,
  type ParcelaLike,
} from "@/lib/forms/payment-seed";

interface PagamentoStepProps {
  form: UseFormReturn<any>;
  /** Form travado: não semeia parcelas (escrita nenhuma em modo leitura). */
  readOnly?: boolean;
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

  const showTipoOutros = tipo === "outros";
  const showPermutaDesc = tipo === "permuta_veiculo" || tipo === "permuta_imovel";
  // `dias` é reusado pelo momento novo `contrato_financiamento` — o prazo da
  // parcela financiada, que antes não tinha campo nenhum (só a escritura tinha,
  // e em OUTRA etapa).
  const showDias = momento === "dias" || momento === "contrato_financiamento";
  const showDataExata = momento === "data_exata";
  const rowLabel = parcelaRowLabel({ tipo, momento }, index);

  // UX 2026-05-16: card enxuto com Valor → Tipo → Quando. Meio de pagamento e
  // dados bancários do vendedor saíram pra etapa Vendedor (recebimento).
  // Banco do financiamento subiu pro card "Financiamento Bancário" no nível
  // raiz da etapa Pagamento (aparece condicional quando há ≥1 parcela
  // tipo=financiamento).
  return (
    <div className="rounded-md border p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {rowLabel}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Parcela {index + 1}
          </span>
        </p>
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
        <FormField label="Valor" className="md:col-span-2">
          <ControlledMoney name={`${base}.valor`} form={form} />
        </FormField>

        <FormField label="Tipo">
          <NativeSelect
            value={tipo || ""}
            onChange={(v) =>
              form.setValue(`${base}.tipo`, v, { shouldDirty: true })
            }
            options={[{ value: "", label: "Selecione..." }, ...TIPO_OPTIONS]}
          />
        </FormField>

        <FormField label="Quando">
          <NativeSelect
            value={momento || "assinatura"}
            onChange={(v) =>
              form.setValue(`${base}.momento`, v, { shouldDirty: true })
            }
            options={MOMENTO_OPTIONS}
          />
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
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring resize-none"
            />
          </FormField>
        )}

        {showDias && (
          <FormField
            label={
              momento === "contrato_financiamento"
                ? "Prazo para assinar o financiamento (dias)"
                : "Dias após a assinatura"
            }
            className="md:col-span-2"
          >
            <Input
              type="number"
              min="0"
              {...form.register(`${base}.dias`, { valueAsNumber: true })}
              placeholder="Ex: 30"
            />
          </FormField>
        )}

        {showDataExata && (
          <FormField label="Data específica" className="md:col-span-2">
            <Input
              type="date"
              {...form.register(`${base}.data_exata`)}
            />
          </FormField>
        )}
      </div>
    </div>
  );
}

export function PagamentoStep({ form, readOnly = false }: PagamentoStepProps) {
  const { fields, append, remove, replace } = useFieldArray({
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
    });
  };

  const pagamento = useWatch({
    control: form.control,
    name: "pagamento",
  }) as
    | {
        valor_total?: number;
        banco_financiamento?: string;
        parcelas?: ParcelaLike[];
      }
    | undefined;

  // `modalidade` já existia no step5Schema (default "a_vista") sem UI nenhuma.
  // Forms antigos não têm o campo gravado — a modalidade real vive nos
  // `parcelas[].tipo`, então derivamos dali pra o seletor abrir marcado certo.
  const modalidadeRaw = useWatch({
    control: form.control,
    name: "modalidade",
  }) as string | undefined;
  const modalidade: Modalidade =
    modalidadeRaw === "financiamento" || modalidadeRaw === "a_vista"
      ? modalidadeRaw
      : deriveModalidadeFromParcelas(
          pagamento?.parcelas,
          pagamento?.banco_financiamento,
        );

  // Semeadura inicial: lista vazia abre com as parcelas típicas da modalidade
  // em vez de um botão "Adicionar Parcela" solitário. Só na montagem da etapa —
  // remover uma parcela não faz a lista se reconstruir embaixo de quem edita.
  const seededRef = useRef(false);
  useEffect(() => {
    if (readOnly || seededRef.current) return;
    seededRef.current = true;
    if ((form.getValues("pagamento.parcelas") as unknown[] | undefined)?.length) {
      // Já tem parcelas: só garante que `modalidade` fique gravada coerente.
      if (!modalidadeRaw) {
        form.setValue("modalidade", modalidade, { shouldDirty: false });
      }
      return;
    }
    replace(seedParcelas(modalidade));
    form.setValue("modalidade", modalidade, { shouldDirty: false });
    // Só na montagem — as dependências são lidas por getValues de propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeModalidade = (next: Modalidade) => {
    if (next === modalidade) return;
    const atuais = (form.getValues("pagamento.parcelas") ?? []) as ParcelaLike[];
    if (!canReseedSilently(atuais, modalidade)) {
      const ok =
        typeof window === "undefined" ||
        window.confirm(
          "Trocar a modalidade vai substituir as parcelas já preenchidas. Continuar?",
        );
      if (!ok) return;
    }
    form.setValue("modalidade", next, { shouldDirty: true });
    replace(seedParcelas(next));
  };

  const valorTotal = Number(pagamento?.valor_total || 0);
  const somaParcelas = (pagamento?.parcelas ?? []).reduce(
    (acc, p) => acc + Number(p?.valor || 0),
    0
  );

  const diferenca = valorTotal - somaParcelas;
  const bate = Math.abs(diferenca) < 0.01;
  const hasValue = valorTotal > 0 || somaParcelas > 0;

  // Card "Financiamento Bancário" aparece quando ≥1 parcela é tipo=financiamento.
  // Banco do financiamento subiu pro nível raiz `pagamento.banco_financiamento`
  // em 2026-05-16 — antes ficava em cada parcela, era redundante.
  const hasFinanciamento = (pagamento?.parcelas ?? []).some(
    (p) => p?.tipo === "financiamento"
  );

  return (
    <div className="space-y-4">
      {/* Modalidade — dirige a semeadura das parcelas. A seleção do template
          continua derivando de `parcelas[].tipo` (deriveCategoryFromPayment);
          como é o seletor que semeia os tipos, os dois nunca divergem. */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Como o imóvel será pago
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {MODALIDADES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => changeModalidade(m)}
                aria-pressed={modalidade === m}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                  modalidade === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-transparent text-muted-foreground hover:bg-muted"
                }`}
              >
                {MODALIDADE_LABELS[m]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {modalidade === "financiamento"
              ? "Abre entrada/sinal e a parcela financiada. O contrato gerado é o de financiamento com alienação fiduciária."
              : "Abre entrada/sinal e o saldo na escritura. Você pode adicionar outras parcelas (FGTS, permuta, consórcio) abaixo."}
          </p>
        </CardContent>
      </Card>

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

      {/* Financiamento Bancário — aparece condicional */}
      {hasFinanciamento && (
        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Financiamento Bancário
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FormField label="Banco do financiamento">
              <NativeSelect
                value={pagamento?.banco_financiamento || ""}
                onChange={(v) =>
                  form.setValue("pagamento.banco_financiamento", v, {
                    shouldDirty: true,
                  })
                }
                options={[
                  { value: "", label: "Selecione o banco..." },
                  ...BANCO_FINANCIAMENTO_OPTIONS,
                ]}
              />
            </FormField>
          </CardContent>
        </Card>
      )}

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
          {fields.length > 0 && (
            <p className="text-sm text-muted-foreground">
              As parcelas abaixo foram abertas conforme a modalidade escolhida.
              Preencha os valores — a soma precisa fechar o valor total.
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
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </FormField>
        </CardContent>
      </Card>
    </div>
  );
}
