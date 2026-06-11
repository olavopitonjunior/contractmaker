"use client";

import { UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UFSelect } from "@/components/forms/UFSelect";
import { FormField } from "./_PartyFields";

/**
 * Confirmação: praça/data de assinatura + foro. O consentimento LGPD é
 * renderizado pelo wizard (PrivacyConsent) abaixo deste step.
 */
export function ConfirmacaoStep({ form }: { form: UseFormReturn<any> }) {
  return (
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Local, data e foro</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Cidade da assinatura">
            <Input {...form.register("assinatura.cidade")} placeholder="Cidade" />
          </FormField>
          <FormField label="UF">
            <UFSelect
              value={form.watch("assinatura.uf")}
              onChange={(v) => form.setValue("assinatura.uf", v, { shouldDirty: true })}
            />
          </FormField>
          <FormField label="Data da assinatura">
            <Input {...form.register("assinatura.data")} type="date" />
          </FormField>
        </div>
        <FormField label="Foro (comarca)">
          <Input
            {...form.register("foro")}
            placeholder="Deixe em branco para usar a comarca do imóvel"
          />
        </FormField>
        <p className="text-xs text-muted-foreground">
          Ao finalizar, o contrato de locação será gerado automaticamente e ficará disponível para
          edição.
        </p>
      </CardContent>
    </Card>
  );
}
