"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, ShieldOff, Pencil, Check, X } from "lucide-react";
import { CreditConsentDialog } from "@/components/pipeline/CreditConsentDialog";
import { RENDA_ORIGENS, rendaOrigemLabel } from "@/lib/fichacerta/renda-origens";
import {
  PRETENDENTE_MISSING_LABELS,
  type Pretendente,
} from "@/lib/credit/pretendentes";
import type { CreditConsent } from "@/lib/credit/consent";
import type { TipoImovel } from "@/lib/fichacerta/types";

interface Props {
  proposalId: string;
  pretendentes: Pretendente[];
  consent: CreditConsent | null;
  tipoImovel: TipoImovel;
  canEdit: boolean;
}

const NONE = "__none__";

function fmtDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function brl(n: number | null): string {
  return n == null ? "" : `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}
function fmtCpf(d: string): string {
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : d;
}

/**
 * "Pretendentes & renda" na tela da proposta de locação: uma linha por
 * consultado (locatário, cônjuge, fiador, cônjuge do fiador) com o que a
 * análise de crédito precisa, chips do que falta e edição inline via
 * `PATCH /api/proposals/[id]/partes` — funciona depois do envio, porque esses
 * dados não entram no documento. No topo, o consentimento LGPD (gate do
 * disparo, PR 6).
 */
export function PartesEditor({ proposalId, pretendentes, consent, tipoImovel, canEdit }: Props) {
  const router = useRouter();
  const [consentOpen, setConsentOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const incompletos = pretendentes.filter((p) => p.missing.length > 0).length;

  async function revoke() {
    setRevoking(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/credit/consent`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(d?.error ?? "Falha ao revogar");
        return;
      }
      toast.success("Consentimento revogado");
      router.refresh();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Pretendentes &amp; renda ({pretendentes.length})</h2>
        {incompletos > 0 ? (
          <Badge variant="outline" className="text-amber-700">
            {incompletos} com dados faltando
          </Badge>
        ) : pretendentes.length > 0 ? (
          <Badge variant="outline" className="text-green-700">
            prontos para análise
          </Badge>
        ) : null}
      </div>

      {/* Consentimento LGPD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
        {consent ? (
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            <span>
              Consentimento LGPD registrado em {fmtDate(consent.at.slice(0, 10))}
              {" · "}
              {consent.baseLegal === "execucao_contrato" ? "Execução de contrato" : "Proteção ao crédito"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldOff className="h-4 w-4" />
            <span>Sem consentimento LGPD — necessário antes de consultar crédito.</span>
          </div>
        )}
        {canEdit &&
          (consent ? (
            <Button variant="ghost" size="sm" onClick={revoke} disabled={revoking}>
              Revogar
            </Button>
          ) : (
            <Button size="sm" onClick={() => setConsentOpen(true)}>
              Registrar consentimento
            </Button>
          ))}
      </div>

      {pretendentes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum pretendente identificado — informe o locatário na proposta.
        </p>
      ) : (
        <div className="space-y-2">
          {pretendentes.map((p) => (
            <PretendenteRow key={`${p.kind}:${p.index}`} proposalId={proposalId} p={p} tipoImovel={tipoImovel} canEdit={canEdit} />
          ))}
        </div>
      )}

      <CreditConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        endpoint={`/api/proposals/${proposalId}/credit/consent`}
        providerLabel="Ficha Certa"
        subjectLabel="esta proposta"
        auditAction="CREDIT_CONSENT_GIVEN"
        onGranted={() => router.refresh()}
      />
    </Card>
  );
}

interface Draft {
  data_nascimento: string;
  nome_mae: string;
  sexo: string;
  rg: string;
  cep: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  renda_mensal: string;
  renda_origem: string;
  renda_outra_valor: string;
  renda_outra_origem: string;
  residir: boolean;
  participante: boolean;
  nome: string;
  cpf: string;
  cnpj: string;
}

function draftOf(p: Pretendente): Draft {
  return {
    data_nascimento: p.dataNascimento.slice(0, 10),
    nome_mae: p.nomeMae,
    sexo: p.sexo,
    rg: p.rg,
    cep: p.endereco.cep,
    endereco: p.endereco.logradouro,
    numero: p.endereco.numero,
    bairro: p.endereco.bairro,
    cidade: p.endereco.cidade,
    uf: p.endereco.uf,
    renda_mensal: p.rendaMensal != null ? String(p.rendaMensal) : "",
    renda_origem: p.rendaOrigem != null ? String(p.rendaOrigem) : "",
    renda_outra_valor: p.rendaOutraValor != null ? String(p.rendaOutraValor) : "",
    renda_outra_origem: p.rendaOutraOrigem != null ? String(p.rendaOutraOrigem) : "",
    residir: p.residir,
    participante: p.participante,
    nome: p.nome,
    cpf: p.cpf,
    cnpj: p.cnpj,
  };
}

function parseMoney(s: string): number | "" {
  const t = s.trim();
  if (!t) return "";
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : "";
}

function PretendenteRow({
  proposalId,
  p,
  tipoImovel,
  canEdit,
}: {
  proposalId: string;
  p: Pretendente;
  tipoImovel: TipoImovel;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [d, setD] = useState<Draft>(() => draftOf(p));
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      if (p.pessoa === "fisica") {
        if (!p.nome && d.nome.trim()) fields.nome = d.nome.trim();
        if (!p.cpf && d.cpf.replace(/\D/g, "")) fields.cpf = d.cpf.replace(/\D/g, "");
        fields.data_nascimento = d.data_nascimento;
        fields.nome_mae = d.nome_mae;
        fields.sexo = d.sexo;
        fields.rg = d.rg;
        fields.renda_mensal = parseMoney(d.renda_mensal);
        fields.renda_origem = d.renda_origem ? Number(d.renda_origem) : "";
        fields.renda_outra_valor = parseMoney(d.renda_outra_valor);
        fields.renda_outra_origem = d.renda_outra_origem ? Number(d.renda_outra_origem) : "";
        if (tipoImovel === "RESIDENCIAL") fields.residir = d.residir;
        else fields.participante = d.participante;
      } else {
        if (!p.nome && d.nome.trim()) fields.razao_social = d.nome.trim();
        if (!p.cnpj && d.cnpj.replace(/\D/g, "")) fields.cnpj = d.cnpj.replace(/\D/g, "");
      }
      fields.cep = d.cep.replace(/\D/g, "");
      fields.endereco = d.endereco;
      fields.numero = d.numero;
      fields.bairro = d.bairro;
      fields.cidade = d.cidade;
      fields.uf = d.uf.toUpperCase();
      const res = await fetch(`/api/proposals/${proposalId}/partes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: { kind: p.kind, index: p.index }, fields }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Falha ao salvar");
        return;
      }
      toast.success("Dados salvos");
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const summary: string[] = [];
  if (p.pessoa === "fisica") {
    if (p.cpf) summary.push(`CPF ${fmtCpf(p.cpf)}`);
    if (p.dataNascimento) summary.push(`nasc. ${fmtDate(p.dataNascimento)}`);
    if (p.rendaMensal != null) summary.push(`renda ${brl(p.rendaMensal)}`);
    const origem = rendaOrigemLabel(p.rendaOrigem);
    if (origem) summary.push(origem);
  } else {
    if (p.cnpj) summary.push(`CNPJ ${p.cnpj}`);
  }
  if (p.endereco.cidade) summary.push(`${p.endereco.cidade}${p.endereco.uf ? `/${p.endereco.uf}` : ""}`);

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.label}</span>
            <span className="font-medium">{p.nome || <span className="text-muted-foreground">sem nome</span>}</span>
            {p.pessoa === "juridica" && <Badge variant="outline">PJ</Badge>}
          </div>
          {summary.length > 0 && <p className="text-xs text-muted-foreground">{summary.join(" · ")}</p>}
          {p.missing.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {p.missing.map((m) => (
                <Badge key={m} variant="outline" className="text-[10px] text-amber-700">
                  falta {PRETENDENTE_MISSING_LABELS[m]}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {canEdit && !editing && (
          <Button variant="ghost" size="sm" onClick={() => { setD(draftOf(p)); setEditing(true); }}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {p.pessoa === "fisica" ? (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                {!p.nome && (
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Nome</Label>
                    <Input value={d.nome} onChange={(e) => set({ nome: e.target.value })} />
                  </div>
                )}
                {!p.cpf && (
                  <div className="space-y-1">
                    <Label className="text-xs">CPF</Label>
                    <Input inputMode="numeric" value={d.cpf} onChange={(e) => set({ cpf: e.target.value })} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Nascimento</Label>
                  <Input type="date" value={d.data_nascimento} onChange={(e) => set({ data_nascimento: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Nome da mãe</Label>
                  <Input value={d.nome_mae} onChange={(e) => set({ nome_mae: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sexo</Label>
                  <Select value={d.sexo || NONE} onValueChange={(v) => set({ sexo: v === NONE ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      <SelectItem value="M">Masculino</SelectItem>
                      <SelectItem value="F">Feminino</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">RG</Label>
                  <Input value={d.rg} onChange={(e) => set({ rg: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Renda mensal (R$)</Label>
                  <Input inputMode="decimal" value={d.renda_mensal} onChange={(e) => set({ renda_mensal: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Origem da renda</Label>
                  <OrigemSelect value={d.renda_origem} onChange={(v) => set({ renda_origem: v })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Outra renda (R$)</Label>
                  <Input inputMode="decimal" value={d.renda_outra_valor} onChange={(e) => set({ renda_outra_valor: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Origem da outra renda</Label>
                  <OrigemSelect value={d.renda_outra_origem} onChange={(v) => set({ renda_outra_origem: v })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={tipoImovel === "RESIDENCIAL" ? d.residir : d.participante}
                  onChange={(e) =>
                    tipoImovel === "RESIDENCIAL" ? set({ residir: e.target.checked }) : set({ participante: e.target.checked })
                  }
                />
                {tipoImovel === "RESIDENCIAL" ? "Vai residir no imóvel" : "Participa do negócio"}
              </label>
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {!p.nome && (
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Razão social</Label>
                  <Input value={d.nome} onChange={(e) => set({ nome: e.target.value })} />
                </div>
              )}
              {!p.cnpj && (
                <div className="space-y-1">
                  <Label className="text-xs">CNPJ</Label>
                  <Input inputMode="numeric" value={d.cnpj} onChange={(e) => set({ cnpj: e.target.value })} />
                </div>
              )}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_1fr_1fr_60px]">
            <div className="space-y-1">
              <Label className="text-xs">CEP</Label>
              <Input inputMode="numeric" value={d.cep} onChange={(e) => set({ cep: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Endereço</Label>
              <Input value={d.endereco} onChange={(e) => set({ endereco: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Número</Label>
              <Input value={d.numero} onChange={(e) => set({ numero: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bairro</Label>
              <Input value={d.bairro} onChange={(e) => set({ bairro: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cidade</Label>
              <Input value={d.cidade} onChange={(e) => set({ cidade: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">UF</Label>
              <Input maxLength={2} value={d.uf} onChange={(e) => set({ uf: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Check className="mr-1 h-3.5 w-3.5" /> Salvar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OrigemSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {RENDA_ORIGENS.map((o) => (
          <SelectItem key={o.code} value={String(o.code)}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
