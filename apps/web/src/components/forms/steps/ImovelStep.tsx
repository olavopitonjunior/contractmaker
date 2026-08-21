"use client";

import { useFieldArray, UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";
import { FormField } from "@/components/forms/fields/FormField";
import { maskCEP } from "@/lib/forms/field-formats";

interface ImovelStepProps {
  form: UseFormReturn<any>;
}

export function ImovelStep({ form }: ImovelStepProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "imoveis",
  });

  const addImovel = () => {
    append({
      rua: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
      cep: "",
      matricula: "",
      cartorio: "",
      inscricao_iptu: "",
      sql: "",
      inscricao_municipal: "",
      tipo_imovel: "",
      descricao: "",
    });
  };

  return (
    <div className="space-y-4">
      {fields.map((field, index) => {
        const prefix = `imoveis.${index}`;

        return (
          <Card key={field.id} className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Imóvel {index + 1}
                </CardTitle>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => remove(index)}
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  >
                    Remover
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* `required` explícito nos três campos que o próprio step
                    registra como obrigatórios (rua/cidade/descricao) — o preset
                    da org pode não marcá-los, mas o register marca. */}
                <FormField
                  form={form}
                  name={`${prefix}.rua`}
                  label="Logradouro (Rua/Avenida)"
                  required
                  className="md:col-span-2"
                >
                  <Input
                    {...form.register(`${prefix}.rua`, {
                      required: "Logradouro é obrigatório",
                    })}
                    placeholder="Ex: Rua das Flores"
                  />
                </FormField>

                <FormField form={form} name={`${prefix}.numero`} label="Número">
                  <Input {...form.register(`${prefix}.numero`)} placeholder="123" />
                </FormField>

                <FormField
                  form={form}
                  name={`${prefix}.complemento`}
                  label="Complemento"
                >
                  <Input
                    {...form.register(`${prefix}.complemento`)}
                    placeholder="Apto, bloco, casa — deixe vazio se não houver"
                  />
                </FormField>

                <FormField form={form} name={`${prefix}.bairro`} label="Bairro">
                  <Input {...form.register(`${prefix}.bairro`)} placeholder="Bairro" />
                </FormField>

                <FormField
                  form={form}
                  name={`${prefix}.cidade`}
                  label="Cidade"
                  required
                >
                  <Input
                    {...form.register(`${prefix}.cidade`, {
                      required: "Cidade é obrigatória",
                    })}
                    placeholder="Cidade"
                  />
                </FormField>

                <FormField form={form} name={`${prefix}.uf`} label="UF">
                  <UFSelect
                    value={form.watch(`${prefix}.uf`)}
                    onChange={(v) => form.setValue(`${prefix}.uf`, v, { shouldDirty: true })}
                  />
                </FormField>

                <FormField form={form} name={`${prefix}.cep`} label="CEP">
                  <Input
                    {...form.register(`${prefix}.cep`, {
                      onChange: (e) =>
                        form.setValue(`${prefix}.cep`, maskCEP(e.target.value), {
                          shouldDirty: true,
                        }),
                    })}
                    inputMode="numeric"
                    placeholder="00000-000"
                  />
                </FormField>
              </div>

              <Separator />

              <p className="text-sm font-semibold text-foreground">
                Dados Registrais
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  form={form}
                  name={`${prefix}.matricula`}
                  label="Matrícula"
                >
                  <Input
                    {...form.register(`${prefix}.matricula`)}
                    placeholder="Número da matrícula"
                  />
                </FormField>

                <FormField
                  form={form}
                  name={`${prefix}.cartorio`}
                  label="Cartório de Registro"
                >
                  <Input
                    {...form.register(`${prefix}.cartorio`)}
                    placeholder="Nome do cartório"
                  />
                </FormField>

                <FormField
                  form={form}
                  name={`${prefix}.inscricao_iptu`}
                  label="Inscrição IPTU"
                >
                  <Input
                    {...form.register(`${prefix}.inscricao_iptu`)}
                    placeholder="Número da inscrição IPTU"
                  />
                </FormField>

                {/* H.15 (Phase H) / Phase L — campos condicionais por UF.
                    SP usa SQL; as demais capitais cobertas (RJ, MG, RS, PR, SC,
                    MT) usam a inscrição municipal/imobiliária para IPTU/CND. */}
                {form.watch(`${prefix}.uf`) === "SP" && (
                  <FormField
                    form={form}
                    name={`${prefix}.sql`}
                    label="SQL (Setor-Quadra-Lote)"
                  >
                    <Input
                      {...form.register(`${prefix}.sql`)}
                      placeholder="Necessário para CND IPTU SP"
                    />
                  </FormField>
                )}

                {form.watch(`${prefix}.uf`) &&
                  form.watch(`${prefix}.uf`) !== "SP" && (
                    <FormField
                      form={form}
                      name={`${prefix}.inscricao_municipal`}
                      label="Inscrição Municipal / Imobiliária"
                    >
                      <Input
                        {...form.register(`${prefix}.inscricao_municipal`)}
                        placeholder="Necessário para CND/IPTU municipal"
                      />
                    </FormField>
                  )}

                <FormField
                  form={form}
                  name={`${prefix}.tipo_imovel`}
                  label="Tipo do imóvel"
                >
                  <select
                    {...form.register(`${prefix}.tipo_imovel`)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="">Não informado</option>
                    <option value="urbano">Urbano</option>
                    <option value="rural">Rural (habilita CCIR)</option>
                  </select>
                </FormField>
              </div>

              <FormField
                form={form}
                name={`${prefix}.descricao`}
                label="Descrição do Imóvel"
                required
              >
                <textarea
                  {...form.register(`${prefix}.descricao`, {
                    required: "Descrição do imóvel é obrigatória",
                    minLength: {
                      value: 10,
                      message: "Descreva com pelo menos 10 caracteres",
                    },
                  })}
                  placeholder="Ex: Apartamento com 3 quartos (sendo 1 suíte), 2 banheiros, sala, cozinha, área de serviço, 1 vaga de garagem coberta, área privativa de 85m²."
                  rows={4}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </FormField>
            </CardContent>
          </Card>
        );
      })}

      <Button
        type="button"
        variant="outline"
        onClick={addImovel}
        className="w-full border-dashed"
      >
        + Adicionar Imóvel
      </Button>
    </div>
  );
}
