"use client";

import { useMemo, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { OBSERVACOES_MAX } from "@/lib/forms/validation";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { resetGarantiaModalidade } from "@/lib/forms/garantia-fiador-flip";
import { FormField } from "@/components/forms/fields/FormField";
import {
  MoneyField,
  PessoaFisicaLocacaoFields,
  PessoaJuridicaLocacaoFields,
} from "./_PartyFields";

import {
  DEFAULT_GARANTIA_OPTIONS,
  providersForTipo,
  tipoTemGarantidor,
  type GarantiaOptionLike,
} from "@/lib/forms/garantia-catalog";
import {
  GARANTIA_LABELS,
  GARANTIA_TIPOS,
} from "@/lib/contracts/template-category";

// Seguro-fiança e garantia onerosa: quem paga a apólice e por quanto tempo ela
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
 * seguro/garantia onerosa → tomador e vigência da apólice.
 *
 * Tipo e prestadora são DOIS campos separados (decisão do dono, 28/08 — o par
 * combinado "Seguro-fiança — Porto Seguro" durou de 2026-07-30 até aqui):
 *
 *   1. "Tipo de garantia" — select FIXO do sistema (as 7 de GARANTIA_TIPOS).
 *      É esta escolha que seleciona o TEMPLATE do contrato, de forma
 *      vinculante (`matchCriteria.garantia`).
 *   2. "Seguradora / prestadora" — só nos tipos com garantidor; opções do
 *      catálogo da org (`garantiaOptions`, que desce server-side pela page —
 *      o form é anônimo) + "Outra…" com texto livre. É o `provider`
 *      normalizado que casa a CLÁUSULA da seguradora no acervo; prestadora
 *      fora do catálogo cai na cláusula genérica do tipo.
 *
 * O shape gravado não mudou: `garantia.tipo` + `garantia.provider`.
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
  const temClausula = form.watch("config.clausula_rescisoria") !== false;
  const tipo = form.watch("garantia.tipo") || "caucao";
  const provider = form.watch("garantia.provider") || "";
  const fiadorTipoPessoa = form.watch("garantia.fiador.tipo_pessoa");
  const tomador = form.watch("garantia.seguro_tomador");
  const vigencia = form.watch("garantia.seguro_vigencia");

  const catalog = garantiaOptions ?? DEFAULT_GARANTIA_OPTIONS;
  const providers = useMemo(
    () => providersForTipo(catalog, tipo),
    [catalog, tipo],
  );
  // "Outra…" é escolha do usuário, não estado do dado — mas um provider
  // gravado que não está (ou não está mais) no catálogo também é "outra":
  // desativar uma seguradora não pode apagar o que o form já tinha.
  const [outraEscolhida, setOutraEscolhida] = useState(false);
  const temGarantidor = tipoTemGarantidor(tipo);
  const isCatalogProvider = providers.includes(provider);
  const showProviderInput =
    temGarantidor &&
    (providers.length === 0 ||
      outraEscolhida ||
      (provider !== "" && !isCatalogProvider));
  const OUTRA = "__outra__";
  const providerSelectValue = isCatalogProvider
    ? provider
    : showProviderInput
      ? OUTRA
      : "";

  const onTipoChange = (value: string) => {
    form.setValue("garantia.tipo", value, { shouldDirty: true });
    // Trocar o tipo zera a modalidade anterior inteira — prestadora, meses de
    // caução, cobertura, título — pelo mesmo helper do flip automático da etapa
    // Documentos. Só a prestadora era zerada: "Fiador" convivia com "Caução: 3
    // aluguéis" no resumo e no contrato (smoke 03/09). `garantia.fiador` fica.
    resetGarantiaModalidade(
      (path) => form.getValues(path as never) as unknown,
      (path, v) => form.setValue(path as never, v as never, { shouldDirty: true })
    );
    setOutraEscolhida(false);
  };

  const onProviderSelect = (value: string) => {
    if (value === OUTRA) {
      setOutraEscolhida(true);
      form.setValue("garantia.provider", "", { shouldDirty: true });
      return;
    }
    setOutraEscolhida(false);
    form.setValue("garantia.provider", value, { shouldDirty: true });
  };

  return (
    <div className="space-y-4">
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Garantia locatícia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <FormField form={form} name="garantia.tipo" label="Tipo de garantia">
            <NativeSelect
              value={tipo}
              onChange={onTipoChange}
              options={GARANTIA_TIPOS.map((t) => ({
                value: t,
                label: GARANTIA_LABELS[t],
              }))}
            />
          </FormField>

          {temGarantidor && providers.length > 0 && (
            <FormField
              form={form}
              name="garantia.provider"
              label="Seguradora / prestadora"
            >
              <NativeSelect
                value={providerSelectValue}
                onChange={onProviderSelect}
                placeholder="Selecione"
                options={[
                  ...providers.map((p) => ({ value: p, label: p })),
                  { value: OUTRA, label: "Outra…" },
                ]}
              />
            </FormField>
          )}

          {showProviderInput && (
            <FormField
              form={form}
              name="garantia.provider"
              label={
                providers.length > 0
                  ? "Qual seguradora / prestadora?"
                  : "Seguradora / prestadora"
              }
            >
              <Input
                {...form.register("garantia.provider")}
                placeholder="Nome da seguradora ou garantidora"
              />
            </FormField>
          )}

          {tipo === "caucao" && (
            <FormField form={form} name="garantia.caucao_meses" label="Caução: nº de aluguéis (máx. 3)">
              <Input
                {...form.register("garantia.caucao_meses", { valueAsNumber: true })}
                type="number"
                min={0}
                max={3}
                inputMode="numeric"
                placeholder="3"
              />
            </FormField>
          )}

          {tipo === "titulo_capitalizacao" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Subscritora saiu daqui: vem da escolha do catálogo (ou do campo
                  "Outro garantidor…" acima). */}
              <FormField form={form} name="garantia.titulo_valor" label="Valor nominal do título (R$)">
                <MoneyField form={form} name="garantia.titulo_valor" placeholder="Ex: 15.000,00" />
              </FormField>
              <FormField form={form} name="garantia.titulo_proposta" label="Nº da proposta/formulário">
                <Input {...form.register("garantia.titulo_proposta")} placeholder="Ex.: 1234567-001" />
              </FormField>
            </div>
          )}

          {(tipo === "seguro_fianca" || tipo === "garantia_onerosa") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Seguradora saiu daqui: é a própria escolha da modalidade. */}
              <FormField form={form} name="garantia.cobertura_meses" label="Cobertura (meses)">
                <Input
                  {...form.register("garantia.cobertura_meses", { valueAsNumber: true })}
                  type="number"
                  inputMode="numeric"
                  placeholder="30"
                />
              </FormField>
              <FormField form={form} name="garantia.seguro_tomador" label="Quem contrata o seguro?">
                <NativeSelect
                  value={tomador ?? ""}
                  onChange={(v) =>
                    form.setValue("garantia.seguro_tomador", v, { shouldDirty: true })
                  }
                  placeholder="Selecione"
                  options={TOMADOR_OPTIONS}
                />
              </FormField>
              <FormField form={form} name="garantia.seguro_vigencia" label="Vigência da apólice">
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
                    onClick={() => form.setValue("garantia.fiador.tipo_pessoa", "fisica", { shouldDirty: true })}
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
                    onClick={() => form.setValue("garantia.fiador.tipo_pessoa", "juridica", { shouldDirty: true })}
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
              {/* Erro do BLOCO fiador (não de um campo): o FormField cobre
                  campo a campo, este é o refine do objeto inteiro. */}
              {typeof (form.formState.errors?.garantia as any)?.fiador?.message === "string" && (
                <p className="mt-1 text-xs text-destructive">
                  {(form.formState.errors?.garantia as any).fiador.message}
                </p>
              )}
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
            <CardTitle className="text-base font-semibold">
              Cláusula rescisória
            </CardTitle>
          </CardHeader>
          {/* Grid com a coluna do numero FIXA em 11rem, e nao 50%.
              Com `md:grid-cols-2` o rotulo de 68 caracteres quebrava em 2-3
              linhas enquanto o vizinho ocupava 1 — e como o FormField e
              `flex-col` sem altura minima no Label, o select descia ~30px em
              relacao ao input. Escolher "Nao" ainda deixava meia linha vazia.
              Agora o texto longo vira `hint` (abaixo do campo, fora do fluxo do
              grid) e o campo de meses tem largura de campo numerico. */}
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <FormField
                form={form}
                name="config.clausula_rescisoria"
                label="Multa por rescisão antecipada"
                hint="Cobra do inquilino que devolve o imóvel antes do fim do prazo, proporcional ao tempo restante (art. 4º da Lei 8.245/91)."
              >
                <NativeSelect
                  value={temClausula ? "sim" : "nao"}
                  onChange={(v) =>
                    form.setValue("config.clausula_rescisoria", v !== "nao", {
                      shouldDirty: true,
                    })
                  }
                  options={[
                    { value: "sim", label: "O contrato terá" },
                    { value: "nao", label: "O contrato não terá" },
                  ]}
                />
              </FormField>
              {/* Sempre MONTADO, desabilitado quando "não": some-lo fazia a
                  linha do grid encolher e o card inteiro pular de altura a cada
                  troca do select. */}
              <FormField
                form={form}
                name="config.multa_rescisoria_meses"
                label="Nº de aluguéis"
                hint={temClausula ? undefined : "Sem cláusula, não se aplica."}
              >
                <Input
                  {...form.register("config.multa_rescisoria_meses", {
                    valueAsNumber: true,
                  })}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={12}
                  placeholder="3"
                  disabled={!temClausula}
                />
              </FormField>
            </div>
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
        <CardContent className="space-y-4 pt-0">
          <FormField form={form} name="observacoes" label="Algo mais que a imobiliária precise saber? (opcional)">
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
