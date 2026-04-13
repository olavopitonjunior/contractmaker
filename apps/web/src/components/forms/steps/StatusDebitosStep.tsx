"use client";

import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { NativeSelect } from "@/components/forms/NativeSelect";

interface StatusDebitosStepProps {
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

export function StatusDebitosStep({ form }: StatusDebitosStepProps) {
  const statusPropriedade = form.watch("status_propriedade");
  const isFinanciado =
    statusPropriedade === "financiado-saldo" ||
    statusPropriedade === "financiado-quitado";

  const temDebitos = form.watch("tem_debitos");
  const iptuSelecionado = form.watch("debitos.iptu.selecionado");
  const condominioSelecionado = form.watch("debitos.condominio.selecionado");

  const viciosOpcao = form.watch("vicios.opcao");
  const debitosAssumidos = form.watch("debitos_assumidos.assume");
  const temRegularizacoes = form.watch("regularizacoes.tem");

  return (
    <div className="space-y-4">
      {/* Status da Propriedade */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Status da Propriedade
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Situação do Imóvel">
            <NativeSelect
              className="w-full md:w-80"
              value={statusPropriedade || "quitado-registrado"}
              onChange={(v) => form.setValue("status_propriedade", v, { shouldDirty: true })}
              options={[
                { value: "quitado-registrado", label: "Quitado e Registrado" },
                { value: "financiado-saldo", label: "Financiado com Saldo Devedor" },
                { value: "financiado-quitado", label: "Financiado mas Quitado (aguardando baixa)" },
              ]}
            />
          </FormField>

          {isFinanciado && (
            <FormField label="Saldo Devedor (R$)" className="max-w-xs">
              <Input
                type="number"
                step="0.01"
                min="0"
                {...form.register("saldo_devedor", { valueAsNumber: true })}
                placeholder="0,00"
              />
            </FormField>
          )}
        </CardContent>
      </Card>

      {/* Débitos */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Débitos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CheckboxField
            id="tem-debitos"
            label="O imóvel possui débitos pendentes"
            checked={!!temDebitos}
            onChange={(v) => form.setValue("tem_debitos", v)}
          />

          {temDebitos && (
            <div className="pl-4 border-l-2 border-border space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <CheckboxField
                    id="iptu-selecionado"
                    label="IPTU"
                    checked={!!iptuSelecionado}
                    onChange={(v) =>
                      form.setValue("debitos.iptu.selecionado", v)
                    }
                  />
                  {iptuSelecionado && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">
                        Valor (R$):
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-40"
                        {...form.register("debitos.iptu.valor", {
                          valueAsNumber: true,
                        })}
                        placeholder="0,00"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <CheckboxField
                    id="condominio-selecionado"
                    label="Condomínio"
                    checked={!!condominioSelecionado}
                    onChange={(v) =>
                      form.setValue("debitos.condominio.selecionado", v)
                    }
                  />
                  {condominioSelecionado && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">
                        Valor (R$):
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-40"
                        {...form.register("debitos.condominio.valor", {
                          valueAsNumber: true,
                        })}
                        placeholder="0,00"
                      />
                    </div>
                  )}
                </div>

                <FormField label="Outros débitos">
                  <textarea
                    {...form.register("debitos.outros")}
                    placeholder="Descreva outros débitos existentes..."
                    rows={3}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                  />
                </FormField>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vicios */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Vícios Construtivos / Ocultos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Cláusula de vícios">
            <NativeSelect
              className="w-full md:w-96"
              value={viciosOpcao || "renuncia"}
              onChange={(v) => form.setValue("vicios.opcao", v, { shouldDirty: true })}
              options={[
                { value: "renuncia", label: "Renúncia - Comprador aceita o imóvel no estado atual" },
                { value: "detalhado", label: "Detalhado - Sem vícios aparentes ou ocultos" },
                { value: "reparar", label: "Reparar - Vendedor se compromete a reparar" },
                { value: "desocultados", label: "Desocultados - Vícios ocultos declarados" },
              ]}
            />
          </FormField>

          {viciosOpcao === "reparar" && (
            <FormField label="Descrição dos reparos a realizar">
              <textarea
                {...form.register("vicios.descricao_reparar")}
                placeholder="Descreva os reparos que o vendedor se compromete a realizar..."
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </FormField>
          )}

          {viciosOpcao === "desocultados" && (
            <FormField label="Descrição dos vicios ocultos declarados">
              <textarea
                {...form.register("vicios.descricao_desocultados")}
                placeholder="Descreva os vicios ocultos que estao sendo declarados..."
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </FormField>
          )}
        </CardContent>
      </Card>

      {/* Débitos Assumidos */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Débitos Assumidos pelo Comprador
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CheckboxField
            id="debitos-assumidos"
            label="Comprador assume debitos existentes do imovel"
            checked={!!debitosAssumidos}
            onChange={(v) => form.setValue("debitos_assumidos.assume", v)}
          />

          {debitosAssumidos && (
            <FormField label="Descrição dos debitos assumidos">
              <textarea
                {...form.register("debitos_assumidos.descricao")}
                placeholder="Descreva os debitos que o comprador esta assumindo..."
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </FormField>
          )}
        </CardContent>
      </Card>

      {/* Regularizacoes */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Regularizacoes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CheckboxField
            id="tem-regularizacoes"
            label="Ha regularizacoes pendentes a serem realizadas"
            checked={!!temRegularizacoes}
            onChange={(v) => form.setValue("regularizacoes.tem", v)}
          />

          {temRegularizacoes && (
            <div className="space-y-4 pl-4 border-l-2 border-border">
              <FormField label="Prazo para regularizacao (dias)" className="max-w-xs">
                <Input
                  type="number"
                  min="1"
                  {...form.register("regularizacoes.prazo_dias", {
                    valueAsNumber: true,
                  })}
                  placeholder="30"
                />
              </FormField>

              <FormField label="Descrição das regularizacoes">
                <textarea
                  {...form.register("regularizacoes.descricao")}
                  placeholder="Descreva as regularizacoes pendentes e os prazos..."
                  rows={3}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </FormField>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
