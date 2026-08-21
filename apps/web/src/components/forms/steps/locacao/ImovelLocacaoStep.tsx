"use client";

import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { maskCEP } from "@/lib/forms/field-formats";
import { FormField } from "@/components/forms/fields/FormField";

const KIND_OPTIONS = [
  { value: "apartamento", label: "Apartamento" },
  { value: "casa", label: "Casa" },
  { value: "comercial_sala", label: "Sala comercial" },
  { value: "loja", label: "Loja" },
  { value: "galpao", label: "Galpão" },
  { value: "terreno", label: "Terreno" },
  { value: "temporada", label: "Temporada" },
];

/**
 * Imóvel da locação (imovelLocacaoSchema). Quando `comercial`, mostra o campo de
 * destinação (ramo de atividade do ponto) que o template comercial renderiza.
 */
export function ImovelLocacaoStep({
  form,
  comercial = false,
}: {
  form: UseFormReturn<any>;
  comercial?: boolean;
}) {
  return (
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Imóvel objeto da locação</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField form={form} name="imovel.kind" label="Tipo do imóvel">
            <NativeSelect
              value={form.watch("imovel.kind") || (comercial ? "comercial_sala" : "apartamento")}
              onChange={(v) => form.setValue("imovel.kind", v, { shouldDirty: true })}
              options={KIND_OPTIONS}
            />
          </FormField>
          {comercial && (
            <FormField form={form} name="imovel.destinacao" label="Destinação / ramo de atividade">
              <Input
                {...form.register("imovel.destinacao")}
                placeholder="Ex.: comércio varejista de vestuário"
              />
            </FormField>
          )}
        </div>

        <Separator />
        <p className="text-sm font-semibold text-foreground">Endereço</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField form={form} name="imovel.rua" label="Logradouro" className="md:col-span-2">
            <Input {...form.register("imovel.rua")} placeholder="Rua, Avenida..." />
          </FormField>
          <FormField form={form} name="imovel.numero" label="Número">
            <Input {...form.register("imovel.numero")} placeholder="123" />
          </FormField>
          <FormField form={form} name="imovel.complemento" label="Complemento">
            <Input {...form.register("imovel.complemento")} placeholder="Apto, Sala..." />
          </FormField>
          <FormField form={form} name="imovel.bairro" label="Bairro">
            <Input {...form.register("imovel.bairro")} placeholder="Bairro" />
          </FormField>
          <FormField form={form} name="imovel.cidade" label="Cidade">
            <Input {...form.register("imovel.cidade")} placeholder="Cidade" />
          </FormField>
          <FormField form={form} name="imovel.uf" label="UF">
            <UFSelect
              value={form.watch("imovel.uf")}
              onChange={(v) => form.setValue("imovel.uf", v, { shouldDirty: true })}
            />
          </FormField>
          <FormField form={form} name="imovel.cep" label="CEP">
            <Input
              {...form.register("imovel.cep", {
                onChange: (e) =>
                  form.setValue("imovel.cep", maskCEP(e.target.value), { shouldDirty: true }),
              })}
              inputMode="numeric"
              placeholder="00000-000"
            />
          </FormField>
        </div>

        <Separator />
        <p className="text-sm font-semibold text-foreground">Registro (opcional)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField form={form} name="imovel.matricula" label="Matrícula">
            <Input {...form.register("imovel.matricula")} placeholder="nº da matrícula" />
          </FormField>
          <FormField form={form} name="imovel.cartorio" label="Cartório">
            <Input {...form.register("imovel.cartorio")} placeholder="Ex.: 1º RI da Comarca" />
          </FormField>
          <FormField form={form} name="imovel.inscricao_iptu" label="Inscrição IPTU">
            <Input {...form.register("imovel.inscricao_iptu")} placeholder="Inscrição municipal" />
          </FormField>
          <FormField form={form} name="imovel.area" label="Área (m²)">
            <Input
              {...form.register("imovel.area", { valueAsNumber: true })}
              type="number"
              inputMode="decimal"
              placeholder="0"
            />
          </FormField>
          <FormField form={form} name="imovel.vagas_garagem" label="Vagas de garagem">
            <Input
              {...form.register("imovel.vagas_garagem", { valueAsNumber: true })}
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="0"
            />
          </FormField>
          <FormField form={form} name="imovel.condominio_nome" label="Condomínio / edifício">
            <Input
              {...form.register("imovel.condominio_nome")}
              placeholder="Ex.: Condomínio Edifício Central"
            />
          </FormField>
        </div>

        <FormField form={form} name="imovel.descricao" label="Descrição do imóvel">
          <Textarea
            {...form.register("imovel.descricao")}
            rows={3}
            placeholder="Descreva cômodos, vagas, mobília, estado de conservação..."
          />
        </FormField>
      </CardContent>
    </Card>
  );
}
