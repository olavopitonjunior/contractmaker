"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { UFSelect } from "@/components/forms/UFSelect";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { NativeSelect } from "@/components/forms/NativeSelect";
import {
  contractSettingsSchema,
  extractContractSettings,
  type ContractSettings,
} from "@/lib/contracts/default-config";

function Field({
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

interface DocReport {
  attempted?: number;
  applied?: number;
  failed?: Array<{ reason: string; text: string }>;
  error?: string;
  skipped?: string;
}

const SKIP_MESSAGE: Record<string, string> = {
  no_google_doc: "Este contrato ainda não tem documento no Google Docs.",
  no_template:
    "Contrato importado: o texto vive no documento enviado, não em um modelo — os valores ficam salvos nos dados.",
  google_docs_engine:
    "Este modelo é um Google Doc timbrado: os valores ficam salvos nos dados, mas o texto precisa ser ajustado no documento.",
};

/**
 * Aba "Configurações" do editor de contrato.
 *
 * Reúne o que antes o CLIENTE respondia na última etapa do formulário público
 * — foro, cláusula de desistência, local/data de assinatura e os parâmetros de
 * multa/juros/prazo. São decisões jurídicas da imobiliária, não de quem
 * preenche o link.
 *
 * Abre já preenchido com o que o contrato REALMENTE renderiza hoje
 * (`extractContractSettings` completa com o padrão da org), e salvar reflete no
 * texto do Google Doc via diff parágrafo-a-parágrafo.
 */
export function ContractSettingsPanel({
  contractId,
  dataJson,
  orgDefaults,
  readOnly = false,
  onSaved,
  onOpenChat,
}: {
  contractId: string;
  dataJson: Record<string, unknown>;
  orgDefaults?: ContractSettings;
  readOnly?: boolean;
  onSaved?: () => void;
  onOpenChat?: (prompt: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<DocReport | null>(null);

  const form = useForm<ContractSettings>({
    resolver: zodResolver(contractSettingsSchema),
    defaultValues: extractContractSettings(dataJson, orgDefaults),
  });

  const permite = form.watch("desistencia.permite");

  async function onSubmit(values: ContractSettings) {
    setSaving(true);
    setReport(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Não foi possível salvar as configurações.");
        return;
      }

      const doc: DocReport = body.doc ?? {};
      setReport(doc);
      const applied = doc.applied ?? 0;
      const failed = doc.failed?.length ?? 0;

      if (doc.skipped) {
        toast.success("Configurações salvas nos dados do contrato.");
      } else if (doc.error) {
        toast.warning(
          "Configurações salvas, mas o documento não pôde ser atualizado agora."
        );
      } else if (applied > 0 && failed === 0) {
        toast.success(`Configurações salvas · ${applied} trecho(s) atualizado(s).`);
      } else if (applied > 0) {
        toast.warning(
          `${applied} trecho(s) atualizado(s); ${failed} não puderam ser aplicados.`
        );
      } else if (failed > 0) {
        toast.warning("Configurações salvas, mas o texto não pôde ser ajustado.");
      } else {
        toast.success("Configurações salvas.");
      }

      form.reset(values);
      onSaved?.();
    } catch {
      toast.error("Erro de rede ao salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  const failed = report?.failed ?? [];

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs text-muted-foreground">
          Estas condições valem para este contrato. Ao salvar, os trechos
          correspondentes são reescritos no documento — o que você já editou à
          mão é preservado.
        </p>

        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Foro de resolução de disputas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Forma de resolução de conflitos">
              <Controller
                control={form.control}
                name="foro"
                render={({ field }) => (
                  <NativeSelect
                    className="w-full"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: "arbitragem", label: "Arbitragem" },
                      { value: "justica-publica", label: "Justiça Comum" },
                    ]}
                  />
                )}
              />
            </Field>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Cláusula de desistência
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="desistencia.permite"
                render={({ field }) => (
                  <input
                    type="checkbox"
                    id="cfg-desistencia"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                )}
              />
              <Label htmlFor="cfg-desistencia" className="text-sm">
                Permite desistência dentro de um prazo
              </Label>
            </div>
            {permite && (
              <Field label="Prazo para desistência (dias)" className="max-w-[12rem]">
                <Input
                  type="number"
                  min={1}
                  {...form.register("desistencia.prazo_dias", { valueAsNumber: true })}
                />
              </Field>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Local e data de assinatura
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cidade" className="col-span-2">
                <Input {...form.register("assinatura.cidade")} placeholder="Cidade" />
              </Field>
              <Field label="UF">
                <Controller
                  control={form.control}
                  name="assinatura.uf"
                  render={({ field }) => (
                    <UFSelect value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <Field label="Data">
                <Input type="date" {...form.register("assinatura.data")} />
              </Field>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Em branco, o contrato usa a cidade do imóvel e a data da
              assinatura.
            </p>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Multas, juros e prazos
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Multa moratória (%)">
              <Input
                type="number"
                step="0.01"
                min={0}
                {...form.register("config.multa_penal_moratoria", {
                  valueAsNumber: true,
                })}
              />
            </Field>
            <Field label="Juros por atraso (% ao mês)">
              <Input
                type="number"
                step="0.01"
                min={0}
                {...form.register("config.juros_mensais_atraso", {
                  valueAsNumber: true,
                })}
              />
            </Field>
            <Field label="Base de cálculo da multa" className="col-span-2">
              <Input {...form.register("config.base_calculo_multa")} />
            </Field>
            <Field label="Atualização monetária" className="col-span-2">
              <Input {...form.register("config.atualizacao_monetaria")} />
            </Field>
            <Field label="Multa compensatória (%)">
              <Input
                type="number"
                step="0.01"
                min={0}
                {...form.register("config.multa_penal_compensatoria", {
                  valueAsNumber: true,
                })}
              />
            </Field>
            <Field label="Multa diária por atraso">
              <Controller
                control={form.control}
                name="config.multa_cominatoria_diaria"
                render={({ field }) => (
                  <MoneyInput value={field.value || 0} onChange={field.onChange} />
                )}
              />
            </Field>
            <Field label="Prazo p/ purgação da mora (dias)">
              <Input
                type="number"
                min={1}
                {...form.register("config.prazo_atraso_rescisao", {
                  valueAsNumber: true,
                })}
              />
            </Field>
            <Field label="Prazo p/ devolução na rescisão (dias)">
              <Input
                type="number"
                min={1}
                {...form.register("config.prazo_multa_rescisoria", {
                  valueAsNumber: true,
                })}
              />
            </Field>
          </CardContent>
        </Card>

        {report?.skipped && SKIP_MESSAGE[report.skipped] && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {SKIP_MESSAGE[report.skipped]}
          </div>
        )}

        {failed.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {failed.length} trecho(s) não foram ajustados automaticamente
            </p>
            <p className="mb-2">
              Esses parágrafos foram editados no documento ou aparecem mais de
              uma vez, então não foram tocados para não sobrescrever seu
              trabalho.
            </p>
            <ul className="mb-2 list-disc space-y-0.5 pl-4">
              {failed.slice(0, 3).map((f, i) => (
                <li key={i} className="truncate">
                  {f.text.slice(0, 90)}
                </li>
              ))}
            </ul>
            {onOpenChat && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  onOpenChat(
                    "Atualize no contrato as condições que acabei de salvar nas configurações (foro, desistência, multas, juros e prazos), ajustando os parágrafos que ficaram desatualizados."
                  )
                }
              >
                Ajustar com o Chat IA
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border-t bg-background p-3">
        <Button
          type="submit"
          className="w-full"
          disabled={saving || readOnly || !form.formState.isDirty}
        >
          {saving ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <Save className="mr-1.5 h-4 w-4" />
              Salvar configurações
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
