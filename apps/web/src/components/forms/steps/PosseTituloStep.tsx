"use client";

import { UseFormReturn } from "react-hook-form";
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
            Situacao de Ocupacao
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="O imovel esta atualmente">
            <Select
              value={ocupacao || "desocupado"}
              onValueChange={(v) => form.setValue("ocupacao", v)}
            >
              <SelectTrigger className="w-full md:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desocupado">Desocupado</SelectItem>
                <SelectItem value="ocupado-terceiro">
                  Ocupado por terceiro (locatario ou outros)
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {isOcupadoTerceiro && (
            <div className="pl-4 border-l-2 border-border space-y-4">
              <p className="text-sm font-semibold text-foreground">
                Dados da Locacao / Ocupacao
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Data de Preferencia para Desocupacao">
                  <Input
                    type="date"
                    {...form.register("locacao.data_preferencia")}
                  />
                </FormField>

                <FormField label="Situacao Atual da Ocupacao" className="md:col-span-2">
                  <textarea
                    {...form.register("locacao.situacao")}
                    placeholder="Descreva a situacao atual da ocupacao (contrato de aluguel, vencimento, etc)..."
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
            <Select
              value={momentoPosse || "assinatura"}
              onValueChange={(v) => {
                form.setValue("entrega_posse.momento", v);
                const textos: Record<string, string> = {
                  assinatura: "assinatura do contrato",
                  quitacao: "quitacao do preco",
                  "30-dias": "30 dias apos a assinatura",
                  "60-dias": "60 dias apos a assinatura",
                  outro: "",
                };
                form.setValue("entrega_posse.momento_texto", textos[v] || "");
              }}
            >
              <SelectTrigger className="w-full md:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="assinatura">
                  Na assinatura do contrato
                </SelectItem>
                <SelectItem value="quitacao">
                  Na quitacao total do preco
                </SelectItem>
                <SelectItem value="30-dias">
                  30 dias apos a assinatura
                </SelectItem>
                <SelectItem value="60-dias">
                  60 dias apos a assinatura
                </SelectItem>
                <SelectItem value="outro">Outro (especificar)</SelectItem>
              </SelectContent>
            </Select>
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
            <FormField label="Opção para emissao do titulo">
              <Select
                value={form.watch("titulo_definitivo.opcao") || "certidoes-apos"}
                onValueChange={(v) =>
                  form.setValue("titulo_definitivo.opcao", v)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="certidoes-apos">
                    Apos obtencao das certidoes negativas
                  </SelectItem>
                  <SelectItem value="quitacao">
                    Apos quitacao total do preco
                  </SelectItem>
                  <SelectItem value="prazo-fixo">
                    Em prazo fixo (em dias)
                  </SelectItem>
                  <SelectItem value="imediato">
                    Imediatamente (escritura na assinatura)
                  </SelectItem>
                </SelectContent>
              </Select>
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
