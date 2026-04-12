"use client";

import { useFieldArray, UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UFSelect } from "@/components/forms/UFSelect";

interface ImovelStepProps {
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
                <FormField label="Logradouro (Rua/Avenida)" className="md:col-span-2">
                  <Input
                    {...form.register(`${prefix}.rua`)}
                    placeholder="Ex: Rua das Flores"
                  />
                </FormField>

                <FormField label="Numero">
                  <Input {...form.register(`${prefix}.numero`)} placeholder="123" />
                </FormField>

                <FormField label="Complemento">
                  <Input
                    {...form.register(`${prefix}.complemento`)}
                    placeholder="Apto, Casa, Bloco..."
                  />
                </FormField>

                <FormField label="Bairro">
                  <Input {...form.register(`${prefix}.bairro`)} placeholder="Bairro" />
                </FormField>

                <FormField label="Cidade">
                  <Input {...form.register(`${prefix}.cidade`)} placeholder="Cidade" />
                </FormField>

                <FormField label="UF">
                  <UFSelect
                    value={form.watch(`${prefix}.uf`)}
                    onChange={(v) => form.setValue(`${prefix}.uf`, v, { shouldDirty: true })}
                  />
                </FormField>

                <FormField label="CEP">
                  <Input
                    {...form.register(`${prefix}.cep`)}
                    placeholder="00000-000"
                  />
                </FormField>
              </div>

              <Separator />

              <p className="text-sm font-semibold text-foreground">
                Dados Registrais
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Matricula">
                  <Input
                    {...form.register(`${prefix}.matricula`)}
                    placeholder="Numero da matricula"
                  />
                </FormField>

                <FormField label="Cartorio de Registro">
                  <Input
                    {...form.register(`${prefix}.cartorio`)}
                    placeholder="Nome do cartorio"
                  />
                </FormField>

                <FormField label="Inscricao IPTU">
                  <Input
                    {...form.register(`${prefix}.inscricao_iptu`)}
                    placeholder="Numero da inscricao IPTU"
                  />
                </FormField>
              </div>

              <FormField label="Descrição do Imóvel">
                <textarea
                  {...form.register(`${prefix}.descricao`)}
                  placeholder="Descrição completa do imovel conforme matricula ou contrato..."
                  rows={4}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
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
