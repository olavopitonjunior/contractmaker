"use client";

import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { NativeSelect } from "@/components/forms/NativeSelect";
import {
  FormField,
  FieldError,
  PessoaFisicaLocacaoFields,
  PessoaJuridicaLocacaoFields,
} from "./_PartyFields";

const TIPO_OPTIONS = [
  { value: "caucao", label: "Caução (depósito)" },
  { value: "fiador", label: "Fiador" },
  { value: "seguro_fianca", label: "Seguro-fiança" },
  { value: "garantia_digital", label: "Garantia locatícia (digital)" },
  { value: "sem_garantia", label: "Sem garantia" },
];

/**
 * Garantia locatícia (garantiaSchema, art. 37 Lei 8.245/91). Campos condicionais
 * por tipo: caução → nº de aluguéis (≤3, art. 38 §2º); fiador → dados do fiador;
 * seguro/garantia digital → provider.
 */
export function GarantiaStep({ form }: { form: UseFormReturn<any> }) {
  const tipo = form.watch("garantia.tipo") || "caucao";
  const fiadorTipoPessoa = form.watch("garantia.fiador.tipo_pessoa");

  return (
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Garantia locatícia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <FormField label="Modalidade de garantia">
          <NativeSelect
            value={tipo}
            onChange={(v) => form.setValue("garantia.tipo", v, { shouldDirty: true })}
            options={TIPO_OPTIONS}
          />
        </FormField>

        {tipo === "caucao" && (
          <FormField label="Caução: nº de aluguéis (máx. 3)">
            <Input
              {...form.register("garantia.caucao_meses", { valueAsNumber: true })}
              type="number"
              min={0}
              max={3}
              inputMode="numeric"
              placeholder="3"
            />
            <FieldError error={(form.formState.errors?.garantia as any)?.caucao_meses} />
          </FormField>
        )}

        {(tipo === "seguro_fianca" || tipo === "garantia_digital") && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Seguradora / provedor">
              <Input {...form.register("garantia.provider")} placeholder="Ex.: Porto Seguro" />
            </FormField>
            <FormField label="Cobertura (meses)">
              <Input
                {...form.register("garantia.cobertura_meses", { valueAsNumber: true })}
                type="number"
                inputMode="numeric"
                placeholder="30"
              />
            </FormField>
          </div>
        )}

        {tipo === "fiador" && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Dados do fiador</p>
              <div className="flex rounded-md border border-input overflow-hidden">
                <button
                  type="button"
                  onClick={() => form.setValue("garantia.fiador.tipo_pessoa", "fisica")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    fiadorTipoPessoa !== "juridica"
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Pessoa Física
                </button>
                <button
                  type="button"
                  onClick={() => form.setValue("garantia.fiador.tipo_pessoa", "juridica")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    fiadorTipoPessoa === "juridica"
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Pessoa Jurídica
                </button>
              </div>
            </div>
            {fiadorTipoPessoa === "juridica" ? (
              <PessoaJuridicaLocacaoFields form={form} prefix="garantia.fiador" />
            ) : (
              <PessoaFisicaLocacaoFields form={form} prefix="garantia.fiador" />
            )}
            <FieldError error={(form.formState.errors?.garantia as any)?.fiador} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
