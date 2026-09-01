"use client";

import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrgSettingsForm } from "@/hooks/use-org-settings-form";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";

export interface AgencyProfile {
  legalName?: string | null;
  cnpj?: string | null;
  creci?: string | null;
  legalAddress?: string | null;
}

const FIELDS: {
  key: keyof AgencyProfile & string;
  label: string;
  placeholder?: string;
  hint?: string;
}[] = [
  {
    key: "legalName",
    label: "Razão social",
    placeholder: "Imobiliária Modelo Ltda",
    hint: "Nomeia a administradora nos contratos de locação e a intermediadora nos de venda.",
  },
  {
    key: "cnpj",
    label: "CNPJ",
    placeholder: "00.000.000/0001-00",
    hint: "Impresso na qualificação da imobiliária.",
  },
  {
    key: "creci",
    label: "CRECI",
    placeholder: "12345-J",
    hint: "Impresso junto ao nome da imobiliária nas cláusulas.",
  },
  {
    key: "legalAddress",
    label: "Endereço completo",
    placeholder: "Rua, nº, bairro, cidade/UF",
  },
];

/**
 * Formulário enxuto do perfil da imobiliária (razão social, CNPJ, CRECI,
 * endereço) — os 4 campos que nomeiam a administradora nos contratos de locação
 * e a intermediadora nos de venda.
 *
 * Salva sozinho (debounce) via `useOrgSettingsForm`, que hidrata do servidor e
 * só transmite campos sujos — trocar de passo no wizard não perde nem apaga
 * nada. Posta no endpoint existente `/api/org/fiscal-settings`.
 */
export function AgencyProfileForm({
  initial,
  onSaved,
}: {
  initial: AgencyProfile;
  onSaved?: () => void;
}) {
  const { form, set, saveNow, status, error, isDirty } = useOrgSettingsForm(
    {
      legalName: initial.legalName ?? "",
      cnpj: initial.cnpj ?? "",
      creci: initial.creci ?? "",
      legalAddress: initial.legalAddress ?? "",
    },
    { onSaved }
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
        <span>
          A <b className="text-info">razão social</b> é o que nomeia a sua imobiliária nos
          contratos — sem ela, a cláusula sai com um texto genérico. CNPJ e CRECI são impressos
          junto ao nome.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`agency-${f.key}`}>{f.label}</Label>
            <Input
              id={`agency-${f.key}`}
              value={form[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              onBlur={() => void saveNow()}
            />
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>
      {/* Sem botão "Salvar" — a seção grava sozinha e a pill é o retorno. Este
          form também vive num passo do wizard de onboarding: sair do passo ou
          da página dispara o flush de unmount do hook. */}
      <div className="flex items-center justify-end">
        <SaveStatusPill status={status} isDirty={isDirty} error={error} />
      </div>
    </div>
  );
}
