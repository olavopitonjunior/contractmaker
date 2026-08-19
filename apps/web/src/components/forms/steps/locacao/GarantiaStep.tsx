"use client";

import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { OBSERVACOES_MAX } from "@/lib/forms/validation";
import { NativeSelect } from "@/components/forms/NativeSelect";
import {
  FormField,
  FieldError,
  MoneyField,
  PessoaFisicaLocacaoFields,
  PessoaJuridicaLocacaoFields,
} from "./_PartyFields";

import {
  buildGarantiaChoices,
  findGarantiaChoice,
  selectedGarantiaChoiceValue,
  type GarantiaOptionLike,
} from "@/lib/forms/garantia-catalog";

// Seguro-fiança e garantia digital: quem paga a apólice e por quanto tempo ela
// vale. Sem opção pré-selecionada — o padrão varia por seguradora/imobiliária,
// então quem preenche escolhe (o schema deixa os dois opcionais).
const TOMADOR_OPTIONS = [
  { value: "inquilino", label: "O inquilino (locatário)" },
  { value: "proprietario", label: "O proprietário (locador)" },
];

const VIGENCIA_OPTIONS = [
  { value: "anual_renovavel", label: "Renovação anual" },
  { value: "prazo_contrato", label: "Prazo do contrato" },
];

/**
 * Garantia locatícia (garantiaSchema, art. 37 Lei 8.245/91). Campos condicionais
 * por tipo: caução → nº de aluguéis (≤3, art. 38 §2º); fiador → dados do fiador;
 * seguro/garantia digital → tomador e vigência da apólice.
 *
 * A modalidade e o GARANTIDOR viraram uma escolha só ("Seguro-fiança — Porto
 * Seguro") em 2026-07-30, alimentada pelo catálogo da imobiliária
 * (`garantiaOptions`, que desce server-side pela page do form — ele é anônimo).
 * Escolher preenche `garantia.tipo` + `garantia.provider` de uma vez; é o
 * `provider` normalizado que casa com a cláusula da seguradora. "Outro
 * garantidor…" mantém o texto livre como escape hatch.
 */
export function GarantiaStep({
  form,
  garantiaOptions,
  pathScope,
}: {
  form: UseFormReturn<any>;
  /** Catálogo da org; ausente = defaults + modalidades sem garantidor. */
  garantiaOptions?: readonly GarantiaOptionLike[];
  /**
   * Escopo do subtoken (ROLE paths). Ausente = token principal (tudo).
   * Cards cujo path está fora do escopo NÃO renderizam — sem isso o
   * locatário/fiador veria campos que o auto-save descarta em silêncio.
   */
  pathScope?: readonly string[];
}) {
  const canConfig = !pathScope || pathScope.includes("config");
  const canObservacoes = !pathScope || pathScope.includes("observacoes");
  const tipo = form.watch("garantia.tipo") || "caucao";
  const provider = form.watch("garantia.provider") || "";
  const fiadorTipoPessoa = form.watch("garantia.fiador.tipo_pessoa");
  const tomador = form.watch("garantia.seguro_tomador");
  const vigencia = form.watch("garantia.seguro_vigencia");

  const choices = useMemo(
    () => buildGarantiaChoices(garantiaOptions),
    [garantiaOptions],
  );
  const selectedValue = selectedGarantiaChoiceValue(choices, tipo, provider);
  const selected = findGarantiaChoice(choices, selectedValue);
  // Texto livre só no escape hatch — nas demais o garantidor vem do catálogo.
  const showProviderInput = Boolean(selected?.isOutro);

  const onChoiceChange = (value: string) => {
    const choice = findGarantiaChoice(choices, value);
    if (!choice) return;
    form.setValue("garantia.tipo", choice.tipo, { shouldDirty: true });
    // "Outro garantidor…" zera o campo pra quem preenche digitar — trocar de
    // Porto Seguro pra "outro" não pode deixar "Porto Seguro" pendurado.
    form.setValue("garantia.provider", choice.isOutro ? "" : choice.provider, {
      shouldDirty: true,
    });
  };

  return (
    <div className="space-y-4">
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Garantia locatícia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <FormField label="Modalidade de garantia">
          <NativeSelect
            value={selectedValue}
            onChange={onChoiceChange}
            options={choices.map((c) => ({ value: c.value, label: c.label }))}
          />
        </FormField>

        {showProviderInput && (
          <FormField label="Garantidor / seguradora">
            <Input
              {...form.register("garantia.provider")}
              placeholder="Nome da seguradora ou garantidora"
            />
          </FormField>
        )}

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

        {tipo === "titulo_capitalizacao" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Subscritora saiu daqui: vem da escolha do catálogo (ou do campo
                "Outro garantidor…" acima). */}
            <FormField label="Valor nominal do título (R$)">
              <MoneyField form={form} name="garantia.titulo_valor" placeholder="Ex: 15.000,00" />
            </FormField>
            <FormField label="Nº da proposta/formulário">
              <Input {...form.register("garantia.titulo_proposta")} placeholder="Ex.: 1234567-001" />
            </FormField>
          </div>
        )}

        {(tipo === "seguro_fianca" || tipo === "garantia_digital") && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Seguradora saiu daqui: é a própria escolha da modalidade. */}
            <FormField label="Cobertura (meses)">
              <Input
                {...form.register("garantia.cobertura_meses", { valueAsNumber: true })}
                type="number"
                inputMode="numeric"
                placeholder="30"
              />
            </FormField>
            <FormField label="Quem contrata o seguro?">
              <NativeSelect
                value={tomador ?? ""}
                onChange={(v) =>
                  form.setValue("garantia.seguro_tomador", v, { shouldDirty: true })
                }
                placeholder="Selecione"
                options={TOMADOR_OPTIONS}
              />
            </FormField>
            <FormField label="Vigência da apólice">
              <NativeSelect
                value={vigencia ?? ""}
                onChange={(v) =>
                  form.setValue("garantia.seguro_vigencia", v, { shouldDirty: true })
                }
                placeholder="Selecione"
                options={VIGENCIA_OPTIONS}
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

      {/* Cláusula rescisória — "Não" tira do contrato a cláusula de multa por
          rescisão antecipada (condicional no template v3 via
          config.clausula_rescisoria). Default true = comportamento histórico.
          Só no token principal: `config` nunca entra no escopo de subtoken. */}
      {canConfig && (
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Cláusula rescisória</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="O contrato terá cláusula rescisória (multa por rescisão antecipada)?">
              <NativeSelect
                value={form.watch("config.clausula_rescisoria") === false ? "nao" : "sim"}
                onChange={(v) =>
                  form.setValue("config.clausula_rescisoria", v !== "nao", {
                    shouldDirty: true,
                  })
                }
                options={[
                  { value: "sim", label: "Sim" },
                  { value: "nao", label: "Não" },
                ]}
              />
            </FormField>
            {form.watch("config.clausula_rescisoria") !== false && (
              <FormField label="Multa rescisória (nº de aluguéis)">
                <Input
                  {...form.register("config.multa_rescisoria_meses", { valueAsNumber: true })}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={12}
                  placeholder="3"
                />
              </FormField>
            )}
          </div>
          {form.watch("config.clausula_rescisoria") === false && (
            <p className="text-xs text-muted-foreground">
              O contrato sairá sem a cláusula de multa por rescisão antecipada.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {/* Observações gerais — paridade com venda (ComissaoConfigStep). Vai pro
          resumo da imobiliária e é lido pela IA como DADO cercado em
          <observacoes_form>, nunca instrução. Não vira texto do contrato. */}
      {canObservacoes && (
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Observações Gerais
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="Algo mais que a imobiliária precise saber? (opcional)">
            <Textarea
              {...form.register("observacoes")}
              rows={5}
              maxLength={OBSERVACOES_MAX}
              placeholder="Combinados, prazos, condições especiais ou qualquer detalhe da negociação que não coube nos campos acima."
            />
          </FormField>
          <p className="mt-2 text-xs text-muted-foreground">
            Entra no resumo enviado à imobiliária e é considerado na análise do
            contrato. Não vira texto do contrato automaticamente.
          </p>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
