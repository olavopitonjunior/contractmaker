"use client";

import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CorretorCombobox,
  type CorretorComboboxOption,
  type CorretorComboboxPage,
} from "@/components/corretores/CorretorCombobox";
import {
  MAX_PARTNER_BROKERS,
  emptyPartnerBroker,
  type PartnerBrokerInput,
} from "@/lib/proposals/partner-brokers";

/**
 * Repeater "Corretores parceiros" da proposta (venda e locação).
 *
 * Duas portas de entrada, como no form de locação: escolher do registry
 * (`/api/proposals/commissioners?q=` — sem exigir permissão financeira) ou
 * cadastrar na hora. Nos dois casos a linha fica editável; o `splitRecipientId`
 * marca a origem e é o que o auto-cadastro do servidor usa para não duplicar.
 */
interface PartnerBrokersFieldProps {
  value: PartnerBrokerInput[];
  onChange: (next: PartnerBrokerInput[]) => void;
  disabled?: boolean;
}

async function fetchOptions(q: string): Promise<CorretorComboboxPage> {
  const res = await fetch(`/api/proposals/commissioners?q=${encodeURIComponent(q)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    items: CorretorComboboxOption[];
    hasMore?: boolean;
  };
  return { items: data.items ?? [], hasMore: data.hasMore };
}

export function PartnerBrokersField({ value, onChange, disabled }: PartnerBrokersFieldProps) {
  const full = value.length >= MAX_PARTNER_BROKERS;

  function update(i: number, patch: Partial<PartnerBrokerInput>) {
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function addFromRegistry(opt: CorretorComboboxOption) {
    if (full) return;
    if (value.some((r) => r.splitRecipientId && r.splitRecipientId === opt.id)) return;
    onChange([
      ...value,
      {
        splitRecipientId: opt.id,
        nome: opt.label,
        creci: opt.creci ?? "",
        phone: opt.phone ?? "",
        email: opt.email ?? "",
      },
    ]);
  }

  function addInline(query: string) {
    if (full) return;
    onChange([...value, { ...emptyPartnerBroker(), nome: query.trim() }]);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Corretores parceiros (acompanham por e-mail)</Label>
        <span className="text-xs text-muted-foreground">
          {value.length}/{MAX_PARTNER_BROKERS}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CorretorCombobox
          onSelect={addFromRegistry}
          fetchOptions={fetchOptions}
          placeholder="Buscar no cadastro de corretores"
          allowCreate={addInline}
          createLabel="Cadastrar parceiro"
          disabled={disabled || full}
          className="min-w-[280px] flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || full}
          onClick={() => addInline("")}
        >
          <UserPlus className="mr-1 h-4 w-4" />
          Adicionar manualmente
        </Button>
      </div>
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((row, i) => (
            <li
              key={`${row.splitRecipientId || "inline"}-${i}`}
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto]"
            >
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input
                  value={row.nome}
                  onChange={(e) => update(i, { nome: e.target.value })}
                  placeholder="Nome do corretor"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CRECI</Label>
                <Input
                  value={row.creci}
                  onChange={(e) => update(i, { creci: e.target.value })}
                  placeholder="Ex: 123456-F/SP"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone</Label>
                <Input
                  value={row.phone}
                  onChange={(e) => update(i, { phone: e.target.value })}
                  placeholder="(11) 99999-0000"
                  inputMode="tel"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">E-mail (opcional)</Label>
                <Input
                  value={row.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                  placeholder="para receber os avisos"
                  inputMode="email"
                  disabled={disabled}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remover parceiro"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Recebem e-mail quando a proposta for encaminhada e quando for assinada. Não assinam,
        não entram na comissão e não aparecem nos documentos. Sem e-mail, o parceiro fica só
        registrado.
      </p>
    </div>
  );
}
