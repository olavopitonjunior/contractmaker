"use client";

import { useFieldArray, UseFormReturn, Controller } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { MoneyInput } from "@/components/forms/MoneyInput";

interface ComissaoConfigStepProps {
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

function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  );
}

export function ComissaoConfigStep({ form }: ComissaoConfigStepProps) {
  const quemPaga = form.watch("comissao.quem_paga");
  const quandoPaga = form.watch("comissao.quando_paga");
  const permiteDesistencia = form.watch("desistencia.permite");
  const foro = form.watch("foro");

  // Testemunhas - use field array for dynamic count but we default to 2
  const { fields: testemunhaFields } = useFieldArray({
    control: form.control,
    name: "testemunhas",
  });

  // Ensure 2 testemunhas are always shown
  const testemunhasCount = Math.max(testemunhaFields.length, 2);

  return (
    <div className="space-y-4">
      {/* Comissão */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Comissão Imobiliária
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Valor da Comissão">
              <Controller
                control={form.control}
                name="comissao.valor"
                render={({ field }) => (
                  <MoneyInput
                    value={field.value || 0}
                    onChange={(v) => field.onChange(v)}
                  />
                )}
              />
            </FormField>

            <FormField label="Quem Paga a Comissão">
              <Select
                value={quemPaga || "comprador"}
                onValueChange={(v) => {
                  form.setValue("comissao.quem_paga", v);
                  const textos: Record<string, string> = {
                    comprador: "Parte Compradora",
                    vendedor: "Parte Vendedora",
                    ambos: "Ambas as Partes",
                    outro: "",
                  };
                  form.setValue("comissao.quem_paga_texto", textos[v] || "");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comprador">Comprador</SelectItem>
                  <SelectItem value="vendedor">Vendedor</SelectItem>
                  <SelectItem value="ambos">Ambos (50/50)</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {quemPaga === "outro" && (
              <FormField label="Especificar quem paga" className="md:col-span-2">
                <Input
                  {...form.register("comissao.quem_paga_texto")}
                  placeholder="Especifique quem paga a comissão..."
                />
              </FormField>
            )}

            <FormField label="Quando Paga a Comissão">
              <Select
                value={quandoPaga || "assinatura"}
                onValueChange={(v) => form.setValue("comissao.quando_paga", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assinatura">
                    Na assinatura do contrato
                  </SelectItem>
                  <SelectItem value="quitacao">
                    Na quitação total
                  </SelectItem>
                  <SelectItem value="registro">
                    No registro da escritura
                  </SelectItem>
                  <SelectItem value="parcelas">Em parcelas</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <Separator />

          <p className="text-sm font-semibold text-foreground">
            Dados da Imobiliária
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Nome da Imobiliária" className="md:col-span-2">
              <Input
                {...form.register("comissao.imobiliaria_nome")}
                placeholder="Razão Social ou Nome Fantasia"
              />
            </FormField>
            <FormField label="CNPJ da Imobiliária">
              <Input
                {...form.register("comissao.imobiliaria_cnpj")}
                placeholder="00.000.000/0000-00"
              />
            </FormField>
            <FormField label="CRECI da Imobiliária">
              <Input
                {...form.register("comissao.creci")}
                placeholder="Ex: J-12345"
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {/* Desistencia */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Cláusula de Desistência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CheckboxField
            id="permite-desistencia"
            label="Permite desistência do negócio dentro de prazo"
            checked={!!permiteDesistencia}
            onChange={(v) => form.setValue("desistencia.permite", v)}
          />

          {permiteDesistencia && (
            <FormField label="Prazo para desistência (dias)" className="max-w-xs">
              <Input
                type="number"
                min="1"
                {...form.register("desistencia.prazo_dias", {
                  valueAsNumber: true,
                })}
                placeholder="7"
              />
            </FormField>
          )}
        </CardContent>
      </Card>

      {/* Foro */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Foro de Resolução de Disputas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="Forma de resolução de conflitos">
            <Select
              value={foro || "arbitragem"}
              onValueChange={(v) => form.setValue("foro", v)}
            >
              <SelectTrigger className="w-full md:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="arbitragem">Arbitragem</SelectItem>
                <SelectItem value="justica-publica">Justiça Comum</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </CardContent>
      </Card>

      {/* Assinatura */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Local e Data de Assinatura
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="Cidade" className="md:col-span-1">
              <Input
                {...form.register("assinatura.cidade")}
                placeholder="Cidade"
              />
            </FormField>
            <FormField label="UF">
              <UFSelect
                value={form.watch("assinatura.uf")}
                onChange={(v) => form.setValue("assinatura.uf", v, { shouldDirty: true })}
              />
            </FormField>
            <FormField label="Data">
              <Input type="date" {...form.register("assinatura.data")} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {/* Testemunhas */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Testemunhas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: testemunhasCount }).map((_, index) => (
            <div key={index} className="space-y-3">
              {index > 0 && <Separator />}
              <p className="text-sm font-medium text-foreground">
                Testemunha {index + 1}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Nome">
                  <Input
                    {...form.register(`testemunhas.${index}.nome`)}
                    placeholder="Nome completo"
                  />
                </FormField>
                <FormField label="CPF">
                  <Input
                    {...form.register(`testemunhas.${index}.cpf`)}
                    placeholder="000.000.000-00"
                  />
                </FormField>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Configurações Contratuais */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Configurações Contratuais
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Multa Penal Moratória (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                {...form.register("config.multa_penal_moratoria", {
                  valueAsNumber: true,
                })}
                placeholder="2"
              />
            </FormField>

            <FormField label="Base de Cálculo da Multa">
              <Input
                {...form.register("config.base_calculo_multa")}
                placeholder="valor da parcela"
              />
            </FormField>

            <FormField label="Juros por Atraso (% ao mês)">
              <Input
                type="number"
                step="0.01"
                min="0"
                {...form.register("config.juros_mensais_atraso", {
                  valueAsNumber: true,
                })}
                placeholder="1"
              />
            </FormField>

            <FormField label="Atualização Monetária">
              <Input
                {...form.register("config.atualizacao_monetaria")}
                placeholder="IPCA"
              />
            </FormField>

            <FormField label="Prazo de Atraso para Rescisão (dias)">
              <Input
                type="number"
                min="1"
                {...form.register("config.prazo_atraso_rescisao", {
                  valueAsNumber: true,
                })}
                placeholder="10"
              />
            </FormField>

            <FormField label="Multa Cominatória Diária">
              <Controller
                control={form.control}
                name="config.multa_cominatoria_diaria"
                render={({ field }) => (
                  <MoneyInput
                    value={field.value || 0}
                    onChange={(v) => field.onChange(v)}
                  />
                )}
              />
            </FormField>

            <FormField label="Multa Penal Compensatória (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                {...form.register("config.multa_penal_compensatoria", {
                  valueAsNumber: true,
                })}
                placeholder="10"
              />
            </FormField>

            <FormField label="Prazo para Multa Rescisória (dias)">
              <Input
                type="number"
                min="1"
                {...form.register("config.prazo_multa_rescisoria", {
                  valueAsNumber: true,
                })}
                placeholder="7"
              />
            </FormField>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
