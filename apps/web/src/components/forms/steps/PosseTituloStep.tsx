"use client";

import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/forms/NativeSelect";

interface PosseTituloStepProps {
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

export function PosseTituloStep({ form }: PosseTituloStepProps) {
  const ocupacao = form.watch("ocupacao");
  const momentoPosse = form.watch("entrega_posse.momento");
  const isOcupadoTerceiro = ocupacao === "ocupado-terceiro";
  const isOutroMomento = momentoPosse === "outro";

  return (
    <div className="space-y-4">
      {/* Ocupacao */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Situação de Ocupação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="O imóvel está atualmente">
            <NativeSelect
              className="w-full md:w-80"
              value={ocupacao || "desocupado"}
              onChange={(v) => form.setValue("ocupacao", v, { shouldDirty: true })}
              options={[
                { value: "desocupado", label: "Desocupado" },
                { value: "ocupado-terceiro", label: "Ocupado por terceiro (locatário ou outros)" },
              ]}
            />
          </FormField>

          {isOcupadoTerceiro && (
            <div className="pl-4 border-l-2 border-border space-y-4">
              <p className="text-sm font-semibold text-foreground">
                Dados da Locação / Ocupação
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Data de Preferência para Desocupação">
                  <Input
                    type="date"
                    {...form.register("locacao.data_preferencia")}
                  />
                </FormField>

                <FormField label="Situação Atual da Ocupação" className="md:col-span-2">
                  <textarea
                    {...form.register("locacao.situacao")}
                    placeholder="Descreva a situação atual da ocupação (contrato de aluguel, vencimento, etc)..."
                    rows={3}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                  />
                </FormField>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entrega de Posse */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Entrega da Posse
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Momento da Entrega da Posse">
            <NativeSelect
              className="w-full md:w-96"
              value={momentoPosse || "assinatura"}
              onChange={(v) => {
                form.setValue("entrega_posse.momento", v, { shouldDirty: true });
                const textos: Record<string, string> = {
                  assinatura: "na data da assinatura do presente instrumento",
                  quitacao: "no ato da quitação integral do preço",
                  "30-dias": "em até 30 (trinta) dias corridos contados da assinatura do presente instrumento",
                  "60-dias": "em até 60 (sessenta) dias corridos contados da assinatura do presente instrumento",
                  outro: "",
                };
                form.setValue("entrega_posse.momento_texto", textos[v] || "", { shouldDirty: true });
              }}
              options={[
                { value: "assinatura", label: "Na assinatura do contrato" },
                { value: "quitacao", label: "Na quitação total do preço" },
                { value: "30-dias", label: "30 dias após a assinatura" },
                { value: "60-dias", label: "60 dias após a assinatura" },
                { value: "outro", label: "Outro (especificar)" },
              ]}
            />
          </FormField>

          {isOutroMomento && (
            <FormField label="Especificar o momento da entrega">
              <Input
                {...form.register("entrega_posse.momento_texto")}
                placeholder="Descreva quando ocorrera a entrega da posse..."
              />
            </FormField>
          )}

          {!isOutroMomento && momentoPosse && (
            <p className="text-sm text-muted-foreground">
              Texto no contrato:{" "}
              <span className="italic">
                &quot;{form.watch("entrega_posse.momento_texto")}&quot;
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Título Definitivo */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Título Definitivo (Escritura)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Opção para emissão do título">
              <NativeSelect
                value={form.watch("titulo_definitivo.opcao") || "certidoes-apos"}
                onChange={(v) =>
                  form.setValue("titulo_definitivo.opcao", v, { shouldDirty: true })
                }
                options={[
                  { value: "certidoes-apos", label: "Após obtenção das certidões negativas" },
                  { value: "quitacao", label: "Após quitação total do preço" },
                  { value: "prazo-fixo", label: "Em prazo fixo (em dias)" },
                  { value: "imediato", label: "Imediatamente (escritura na assinatura)" },
                ]}
              />
            </FormField>

            <FormField label="Prazo (dias)">
              <Input
                type="number"
                min="1"
                {...form.register("titulo_definitivo.prazo_dias", {
                  valueAsNumber: true,
                })}
                placeholder="60"
              />
            </FormField>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
