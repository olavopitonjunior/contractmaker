"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export interface FiscalSettings {
  legalName?: string | null;
  cnpj?: string | null;
  creci?: string | null;
  legalAddress?: string | null;
  fiscalResponsibleCpf?: string | null;
  fiscalUf?: string | null;
  fiscalMunicipioCode?: string | null;
  fiscalMunicipioName?: string | null;
}

const FIELDS: {
  key: keyof FiscalSettings;
  label: string;
  placeholder?: string;
  hint?: string;
}[] = [
  { key: "legalName", label: "Razão social", placeholder: "Imobiliária Modelo Ltda" },
  { key: "cnpj", label: "CNPJ", placeholder: "00.000.000/0001-00" },
  { key: "creci", label: "CRECI (opcional)" },
  { key: "legalAddress", label: "Endereço completo", placeholder: "Rua, nº, bairro, cidade" },
  { key: "fiscalResponsibleCpf", label: "CPF do responsável perante a RFB", placeholder: "000.000.000-00" },
  { key: "fiscalUf", label: "UF", placeholder: "SP" },
  { key: "fiscalMunicipioCode", label: "Código do município (RFB/IBGE)", placeholder: "7107", hint: "Código do município na tabela da Receita/IBGE." },
  { key: "fiscalMunicipioName", label: "Município (nome, opcional)", placeholder: "São Paulo" },
];

export function FiscalSettingsForm({ initial }: { initial: FiscalSettings }) {
  const [form, setForm] = useState<FiscalSettings>(initial);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FiscalSettings, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/org/fiscal-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(
            FIELDS.map((f) => [f.key, (form[f.key] ?? "").toString().trim()])
          )
        ),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao salvar");
      }
      toast.success("Dados fiscais salvos.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identificação do declarante</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                value={(form[f.key] ?? "").toString()}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando…" : "Salvar dados fiscais"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
