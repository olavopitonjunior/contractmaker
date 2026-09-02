"use client";

import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { useOrgSettingsForm } from "@/hooks/use-org-settings-form";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";

/** Colunas de recebimento de `Organization` (mesmos nomes de `SplitRecipient`). */
export interface AgencyReceiving {
  pixAddressKey?: string | null;
  pixKeyType?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccount?: string | null;
  bankAccountType?: string | null;
  bankHolderName?: string | null;
  bankHolderDoc?: string | null;
}

const PIX_TYPES = [
  { value: "", label: "—" },
  { value: "CNPJ", label: "CNPJ" },
  { value: "CPF", label: "CPF" },
  { value: "EMAIL", label: "E-mail" },
  { value: "PHONE", label: "Telefone" },
  { value: "EVP", label: "Aleatória" },
];

const ACCOUNT_TYPES = [
  { value: "", label: "—" },
  { value: "corrente", label: "Corrente" },
  { value: "poupanca", label: "Poupança" },
];

/**
 * Onde a imobiliária recebe a comissão de intermediação (1º aluguel) — vira a
 * chave `{{imobiliaria_dados_pagamento}}` dos modelos de locação. Dado fixo do
 * cadastro, por isso mora no Perfil (ao lado de CNPJ e CRECI) e não no padrão
 * por formulário.
 *
 * Salva sozinho pelo mesmo hook e endpoint do perfil (`/api/org/fiscal-
 * settings`): só as chaves tocadas vão no PATCH. Os selects gravam "" para
 * "não informado" — o Zod da rota aceita o enum OU "".
 */
export function AgencyReceivingForm({ initial }: { initial: AgencyReceiving }) {
  const { form, set, saveNow, status, error, isDirty } = useOrgSettingsForm({
    pixAddressKey: initial.pixAddressKey ?? "",
    pixKeyType: initial.pixKeyType ?? "",
    bankName: initial.bankName ?? "",
    bankBranch: initial.bankBranch ?? "",
    bankAccount: initial.bankAccount ?? "",
    bankAccountType: initial.bankAccountType ?? "",
    bankHolderName: initial.bankHolderName ?? "",
    bankHolderDoc: initial.bankHolderDoc ?? "",
  });

  const text = (
    key: keyof typeof form & string,
    label: string,
    opts: { placeholder?: string; maxLength: number; hint?: string; span?: boolean } = { maxLength: 200 }
  ) => (
    <div className={`space-y-1.5${opts.span ? " sm:col-span-2" : ""}`}>
      <Label htmlFor={`receiving-${key}`}>{label}</Label>
      <Input
        id={`receiving-${key}`}
        value={form[key]}
        placeholder={opts.placeholder}
        maxLength={opts.maxLength}
        onChange={(e) => set(key, e.target.value)}
        onBlur={() => void saveNow()}
      />
      {opts.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
        <span>
          Preenche a chave <code>{"{{imobiliaria_dados_pagamento}}"}</code> dos modelos de
          locação — é o que tira a conta da imobiliária do texto do modelo (conta escrita no
          modelo bloqueia a ativação). Com a chave PIX informada, ela vale; sem PIX, a conta só
          entra no contrato quando banco, agência, conta e tipo estiverem preenchidos. Em
          branco, a chave sai vazia.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="receiving-pixKeyType">Tipo da chave PIX</Label>
          <NativeSelect
            value={form.pixKeyType}
            // Só `set`: o debounce do hook grava o valor NOVO. `saveNow` aqui
            // leria o `formRef` do render anterior e gravaria o valor velho.
            onChange={(v) => set("pixKeyType", v)}
            options={PIX_TYPES}
          />
        </div>
        {text("pixAddressKey", "Chave PIX", {
          placeholder: "Ex.: 12.345.678/0001-90",
          maxLength: 200,
        })}
        {text("bankName", "Banco", { placeholder: "Ex.: Itaú", maxLength: 80 })}
        {text("bankBranch", "Agência", { maxLength: 20 })}
        {text("bankAccount", "Conta", { maxLength: 30 })}
        <div className="space-y-1.5">
          <Label htmlFor="receiving-bankAccountType">Tipo de conta</Label>
          <NativeSelect
            value={form.bankAccountType}
            onChange={(v) => set("bankAccountType", v)}
            options={ACCOUNT_TYPES}
          />
        </div>
        {text("bankHolderName", "Titular", {
          placeholder: "Razão social, se diferente",
          maxLength: 200,
        })}
        {text("bankHolderDoc", "CNPJ/CPF do titular", { maxLength: 18 })}
      </div>
      <div className="flex items-center justify-end">
        <SaveStatusPill status={status} isDirty={isDirty} error={error} />
      </div>
    </div>
  );
}
