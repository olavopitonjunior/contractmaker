"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export interface AgencyProfile {
  legalName?: string | null;
  cnpj?: string | null;
  creci?: string | null;
  legalAddress?: string | null;
}

const FIELDS: {
  key: keyof AgencyProfile;
  label: string;
  placeholder?: string;
  hint?: string;
}[] = [
  {
    key: "legalName",
    label: "Razão social",
    placeholder: "Imobiliária Modelo Ltda",
    hint: "Nome que aparece como administradora nos contratos de locação.",
  },
  { key: "cnpj", label: "CNPJ", placeholder: "00.000.000/0001-00" },
  {
    key: "creci",
    label: "CRECI",
    placeholder: "12345-J",
    hint: "Liga a cláusula da administradora — sem ele o contrato usa um texto genérico.",
  },
  {
    key: "legalAddress",
    label: "Endereço completo",
    placeholder: "Rua, nº, bairro, cidade/UF",
  },
];

/**
 * Formulário enxuto do perfil da imobiliária (razão social, CNPJ, CRECI,
 * endereço) — os 4 campos que nomeiam a administradora nos contratos de locação.
 * Posta no endpoint existente `/api/org/fiscal-settings` (gate ORG_SETTINGS_EDIT).
 */
export function AgencyProfileForm({
  initial,
  onSaved,
}: {
  initial: AgencyProfile;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<AgencyProfile>(initial);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof AgencyProfile, value: string) =>
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
      toast.success("Perfil da imobiliária salvo.");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
        <span>
          O <b className="text-info">CRECI</b> liga a cláusula da administradora nos contratos —
          sem ele, o contrato usa um texto genérico.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`agency-${f.key}`}>{f.label}</Label>
            <Input
              id={`agency-${f.key}`}
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
          {saving ? "Salvando…" : "Salvar perfil"}
        </Button>
      </div>
    </div>
  );
}
