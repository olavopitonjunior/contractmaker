"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RENDA_ORIGENS } from "@/lib/fichacerta/renda-origens";
import type { PartyInput } from "@/lib/proposals/form-data";

interface Props {
  party: PartyInput;
  onChange: (patch: Partial<PartyInput>) => void;
  /** Mostra os campos do cônjuge (locatário e fiador PF). */
  withConjuge?: boolean;
}

const NONE = "__none__";

/**
 * "Dados para análise de crédito (opcional)" — bloco colapsável por parte PF
 * no formulário da proposta de locação. Nascimento, nome da mãe, sexo, RG,
 * endereço, renda e origem (tabela da Ficha Certa), outra renda e cônjuge.
 * Tudo opcional: o que faltar aparece como pendência no editor de partes da
 * tela da proposta, e o OCR dos documentos preenche o resto.
 */
export function CreditFieldsBlock({ party, onChange, withConjuge = true }: Props) {
  const [open, setOpen] = useState(false);
  const conj = party.conjuge ?? { nome: "", documento: "" };
  const setConj = (patch: Partial<typeof conj>) => onChange({ conjuge: { ...conj, ...patch } });

  const filled = [party.dataNascimento, party.nomeMae, party.rendaMensal, party.cidade, conj.nome].filter(
    (v) => v && v.trim()
  ).length;

  return (
    <div className="rounded-md border border-dashed">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Dados para análise de crédito (opcional)
        {filled > 0 && <span className="ml-auto text-[11px]">{filled} preenchido(s)</span>}
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Nascimento</Label>
              <Input
                type="date"
                value={party.dataNascimento ?? ""}
                onChange={(e) => onChange({ dataNascimento: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Nome da mãe</Label>
              <Input value={party.nomeMae ?? ""} onChange={(e) => onChange({ nomeMae: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sexo</Label>
              <Select value={party.sexo || NONE} onValueChange={(v) => onChange({ sexo: v === NONE ? "" : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="M">Masculino</SelectItem>
                  <SelectItem value="F">Feminino</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">RG</Label>
              <Input value={party.rg ?? ""} onChange={(e) => onChange({ rg: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CEP</Label>
              <Input inputMode="numeric" value={party.cep ?? ""} onChange={(e) => onChange({ cep: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cidade</Label>
              <Input value={party.cidade ?? ""} onChange={(e) => onChange({ cidade: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">UF</Label>
              <Input maxLength={2} value={party.uf ?? ""} onChange={(e) => onChange({ uf: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="space-y-1">
              <Label className="text-xs">Endereço</Label>
              <Input value={party.endereco ?? ""} onChange={(e) => onChange({ endereco: e.target.value })} placeholder="Rua, avenida…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Número</Label>
              <Input value={party.numero ?? ""} onChange={(e) => onChange({ numero: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bairro</Label>
              <Input value={party.bairro ?? ""} onChange={(e) => onChange({ bairro: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Renda mensal (R$)</Label>
              <Input inputMode="decimal" value={party.rendaMensal ?? ""} onChange={(e) => onChange({ rendaMensal: e.target.value })} placeholder="3.500,00" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Origem da renda</Label>
              <OrigemSelect value={party.rendaOrigem ?? ""} onChange={(v) => onChange({ rendaOrigem: v })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Outra renda (R$)</Label>
              <Input inputMode="decimal" value={party.rendaOutraValor ?? ""} onChange={(e) => onChange({ rendaOutraValor: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Origem da outra renda</Label>
              <OrigemSelect value={party.rendaOutraOrigem ?? ""} onChange={(v) => onChange({ rendaOutraOrigem: v })} />
            </div>
          </div>
          {withConjuge && (
            <div className="space-y-2 rounded-md bg-muted/30 p-2">
              <p className="text-xs font-medium text-muted-foreground">Cônjuge (se houver)</p>
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                <Input value={conj.nome} onChange={(e) => setConj({ nome: e.target.value })} placeholder="Nome do cônjuge" />
                <Input inputMode="numeric" value={conj.documento} onChange={(e) => setConj({ documento: e.target.value })} placeholder="CPF" />
                <Input type="date" value={conj.dataNascimento ?? ""} onChange={(e) => setConj({ dataNascimento: e.target.value })} />
              </div>
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                <Input value={conj.nomeMae ?? ""} onChange={(e) => setConj({ nomeMae: e.target.value })} placeholder="Nome da mãe do cônjuge" />
                <Input inputMode="decimal" value={conj.rendaMensal ?? ""} onChange={(e) => setConj({ rendaMensal: e.target.value })} placeholder="Renda (R$)" />
                <OrigemSelect value={conj.rendaOrigem ?? ""} onChange={(v) => setConj({ rendaOrigem: v })} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrigemSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Origem" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {RENDA_ORIGENS.map((o) => (
          <SelectItem key={o.code} value={String(o.code)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
