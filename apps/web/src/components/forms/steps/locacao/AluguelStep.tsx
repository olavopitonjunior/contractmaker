"use client";

import { useEffect, useRef } from "react";
import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { seedOutrosEncargos, sumEncargosMensais } from "@/lib/forms/validation-locacao";
import { formatMoneyBR } from "@/lib/format/money";
import { MoneyField } from "./_PartyFields";
import { FormField } from "@/components/forms/fields/FormField";

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

const SIM_NAO_OPTIONS = [
  { value: "", label: "Selecione…" },
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

const ENCARGOS_REPASSE_OPTIONS = [
  { value: "", label: "Selecione…" },
  {
    value: "paga_e_retem",
    label: "A imobiliária paga os encargos e retém no valor do aluguel",
  },
  {
    value: "repasse_integral",
    label: "Repassa integral para pagamento junto do aluguel",
  },
];

const CONTAS_CONSUMO = [
  { value: "agua", label: "Água" },
  { value: "luz", label: "Luz" },
  { value: "gas", label: "Gás" },
] as const;

/** boolean|undefined ↔ select "sim"/"nao"/"" (ausente = form antigo). */
const boolToSelect = (v: unknown) => (v === true ? "sim" : v === false ? "nao" : "");

/**
 * Aluguel & reajuste (aluguelSchema). A taxa de administração e os campos
 * fiscais (regime IR, repasse, NFS-e) NÃO aparecem aqui — são definidos pelo
 * operador no diálogo de criação do formulário.
 *
 * Encargos: condomínio + IPTU + outros são os campos de ENTRADA; o total
 * (`aluguel.encargos`, que alimenta LeaseContract.valorEncargos) é derivado e
 * só exibido.
 */
export function AluguelStep({ form }: { form: UseFormReturn<any> }) {
  const condominio = form.watch("aluguel.condominio_mensal");
  const iptu = form.watch("aluguel.iptu_mensal");
  const outros = form.watch("aluguel.outros_encargos");
  const admImobiliaria = form.watch("aluguel.adm_imobiliaria");
  const individualizadas = form.watch("aluguel.contas_consumo_individualizadas");
  const contasNoCondominio: string[] = form.watch("aluguel.contas_no_condominio") ?? [];
  const condominioNome = form.watch("imovel.condominio_nome");
  const temCondominio = Boolean(condominioNome) || (Number(condominio) || 0) > 0;
  const encargosTotal = sumEncargosMensais({
    condominio_mensal: Number(condominio) || 0,
    iptu_mensal: Number(iptu) || 0,
    outros_encargos: Number(outros) || 0,
  });

  const seededRef = useRef(false);

  useEffect(() => {
    const aluguel = (form.getValues("aluguel" as never) ?? {}) as Record<string, unknown>;

    // Migração suave do form legado (ou do OCR): `encargos` era um total
    // digitado à mão. Ao abrir, a diferença entre ele e os itens detalhados vai
    // pra "outros encargos", de modo que o total continue batendo com o que já
    // estava gravado — nada é perdido. Só na primeira passada; depois disso a
    // soma manda. Idempotente: reaberto, legado já == soma e não re-semeia.
    if (!seededRef.current) {
      seededRef.current = true;
      const semeado = seedOutrosEncargos(aluguel);
      if (semeado !== null) {
        form.setValue("aluguel.outros_encargos", semeado, { shouldDirty: false });
        return; // o setValue re-dispara este efeito com o item já semeado
      }
    }

    const total = sumEncargosMensais(aluguel);
    if ((Number(aluguel.encargos) || 0) !== total) {
      form.setValue("aluguel.encargos", total, { shouldDirty: true });
    }
  }, [condominio, iptu, outros, form]);

  return (
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Aluguel e reajuste</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField form={form} name="aluguel.valor" label="Valor do aluguel (R$)">
            <MoneyField form={form} name="aluguel.valor" placeholder="Ex: 2.500,00" />
          </FormField>
          <FormField form={form} name="aluguel.dia_vencimento" label="Dia de vencimento">
            <NativeSelect
              value={String(form.watch("aluguel.dia_vencimento") || 10)}
              onChange={(v) =>
                form.setValue("aluguel.dia_vencimento", Number(v), { shouldDirty: true })
              }
              options={DIA_OPTIONS}
            />
          </FormField>
          <FormField form={form} name="aluguel.meio_pagamento" label="Forma de pagamento">
            <NativeSelect
              value={form.watch("aluguel.meio_pagamento") || "pix"}
              onChange={(v) => form.setValue("aluguel.meio_pagamento", v, { shouldDirty: true })}
              options={MEIO_PAGAMENTO_OPTIONS}
            />
          </FormField>
          <FormField form={form} name="aluguel.indice_reajuste" label="Índice de reajuste">
            <NativeSelect
              value={form.watch("aluguel.indice_reajuste") || "IGPM"}
              onChange={(v) => form.setValue("aluguel.indice_reajuste", v, { shouldDirty: true })}
              options={INDICE_OPTIONS}
            />
          </FormField>
          <FormField form={form} name="aluguel.vigencia_inicio" label="Início da vigência">
            <Input {...form.register("aluguel.vigencia_inicio")} type="date" />
          </FormField>
          <FormField form={form} name="aluguel.vigencia_meses" label="Prazo (meses)">
            <Input
              {...form.register("aluguel.vigencia_meses", { valueAsNumber: true })}
              type="number"
              inputMode="numeric"
              placeholder="30"
            />
          </FormField>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Encargos mensais</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Valores lançados no mesmo boleto do aluguel. O total é somado
              automaticamente.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField form={form} name="aluguel.condominio_mensal" label="Condomínio (R$)">
              <MoneyField form={form} name="aluguel.condominio_mensal" placeholder="Ex: 450,00" />
            </FormField>
            <FormField form={form} name="aluguel.iptu_mensal" label="IPTU (R$)">
              <MoneyField form={form} name="aluguel.iptu_mensal" placeholder="Ex: 120,00" />
            </FormField>
            <FormField form={form} name="aluguel.outros_encargos" label="Outros encargos (R$)">
              <MoneyField form={form} name="aluguel.outros_encargos" placeholder="Ex: 60,00" />
            </FormField>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
            <span className="text-sm font-medium text-muted-foreground">
              Encargos mensais (total)
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {formatMoneyBR(encargosTotal)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Despesas e administração</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define como as despesas transitam e quais cláusulas entram no contrato.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField form={form} name="aluguel.adm_imobiliaria" label="A locação terá administração pela imobiliária?">
              <NativeSelect
                value={boolToSelect(admImobiliaria)}
                onChange={(v) =>
                  form.setValue(
                    "aluguel.adm_imobiliaria",
                    v === "" ? undefined : v === "sim",
                    { shouldDirty: true }
                  )
                }
                options={SIM_NAO_OPTIONS}
              />
            </FormField>
            {admImobiliaria === true && (
              <>
                <FormField form={form} name="aluguel.encargos_repasse" label="Como a imobiliária trata os encargos?">
                  <NativeSelect
                    value={form.watch("aluguel.encargos_repasse") || ""}
                    onChange={(v) =>
                      form.setValue("aluguel.encargos_repasse", v === "" ? undefined : v, {
                        shouldDirty: true,
                      })
                    }
                    options={ENCARGOS_REPASSE_OPTIONS}
                  />
                </FormField>
                <FormField form={form} name="aluguel.taxa_admin_percent" label="Taxa de administração (%)">
                  <Input
                    {...form.register("aluguel.taxa_admin_percent", { valueAsNumber: true })}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.5"
                    placeholder="10"
                  />
                </FormField>
              </>
            )}
          </div>

          {temCondominio && (
            <div className="space-y-3 border-t border-dashed border-border pt-3">
              <FormField form={form} name="aluguel.contas_consumo_individualizadas" label="As contas de consumo (água, luz, gás) são individualizadas?">
                <NativeSelect
                  value={boolToSelect(individualizadas)}
                  onChange={(v) =>
                    form.setValue(
                      "aluguel.contas_consumo_individualizadas",
                      v === "" ? undefined : v === "sim",
                      { shouldDirty: true }
                    )
                  }
                  options={SIM_NAO_OPTIONS}
                />
              </FormField>
              {individualizadas === false && (
                <FormField form={form} name="aluguel.contas_no_condominio" label="Quais somam no boleto do condomínio?">
                  <div className="flex flex-wrap gap-4 pt-1">
                    {CONTAS_CONSUMO.map((c) => (
                      <label key={c.value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={contasNoCondominio.includes(c.value)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...contasNoCondominio, c.value]
                              : contasNoCondominio.filter((x) => x !== c.value);
                            form.setValue("aluguel.contas_no_condominio", next, {
                              shouldDirty: true,
                            });
                          }}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </FormField>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
