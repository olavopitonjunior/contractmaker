"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileCheck, RefreshCcw } from "lucide-react";

interface Props {
  leaseContractId: string;
  valorAluguel: number;
  /** true quando o contrato já tem garantia — o POST vai com substituir:true. */
  substituicao: boolean;
}

const MODALIDADES: Array<{ value: string; label: string }> = [
  { value: "seguro_fianca", label: "Seguro-fiança" },
  { value: "fiador", label: "Fiador" },
  { value: "titulo_capitalizacao", label: "Título de capitalização" },
  { value: "caucao", label: "Caução" },
  { value: "garantia_digital", label: "Garantia digital (CredPago/Garantti)" },
  { value: "cessao_fiduciaria", label: "Cessão fiduciária" },
];

const PROVIDERS_FIANCA = ["Porto Seguro", "Tokio Marine", "Pottencial", "Too Seguros"];
const PROVIDERS_CAP = ["PortoCap", "Icatu"];
const PROVIDERS_DIGITAL = ["credpago", "garantti", "creditas"];

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ContratarGarantiaDialog({ leaseContractId, valorAluguel, substituicao }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tipo, setTipo] = useState("seguro_fianca");
  const [form, setForm] = useState({
    provider: "",
    providerOutro: "",
    premioMensal: "",
    taxaMensal: "",
    coberturaMeses: "12",
    externalRef: "",
    valorTitulo: "",
    valorCaucao: "",
    caucaoSubtipo: "valor",
    banco: "",
    agencia: "",
    conta: "",
    dataDeposito: "",
    valorCedido: "",
    fiadorNome: "",
    fiadorCpf: "",
    fiadorTelefone: "",
    fiadorEmail: "",
    fiadorEndereco: "",
    fiadorProfissao: "",
    fiadorRenda: "",
    observacoes: "",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const providerFinal = form.provider === "__outro" ? form.providerOutro.trim() : form.provider;
  const caucaoExcede =
    tipo === "caucao" && Number(form.valorCaucao) > 0 && Number(form.valorCaucao) > valorAluguel * 3;

  type BuildResult =
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; error: string };

  function buildPayload(): BuildResult {
    const wrap = (payload: Record<string, unknown>): BuildResult => ({ ok: true, payload });
    const fail = (error: string): BuildResult => ({ ok: false, error });
    const base = {
      tipo,
      leaseContractId,
      substituir: substituicao,
      coberturaMeses: form.coberturaMeses ? Number(form.coberturaMeses) : undefined,
      externalRef: form.externalRef.trim() || undefined,
      observacoes: form.observacoes.trim() || undefined,
    };
    switch (tipo) {
      case "fiador":
        if (form.fiadorNome.trim().length < 2) return fail("Informe o nome do fiador.");
        return wrap({
          ...base,
          coberturaMeses: undefined,
          fiador: {
            nome: form.fiadorNome.trim(),
            cpf: form.fiadorCpf.trim() || undefined,
            telefone: form.fiadorTelefone.trim() || undefined,
            email: form.fiadorEmail.trim() || undefined,
            endereco: form.fiadorEndereco.trim() || undefined,
            profissao: form.fiadorProfissao.trim() || undefined,
            rendaMensal: form.fiadorRenda ? Number(form.fiadorRenda) : undefined,
          },
        });
      case "seguro_fianca":
        if (providerFinal.length < 2) return fail("Informe a seguradora.");
        return wrap({
          ...base,
          provider: providerFinal,
          premioMensal: form.premioMensal ? Number(form.premioMensal) : undefined,
        });
      case "titulo_capitalizacao":
        if (providerFinal.length < 2) return fail("Informe o provedor do título.");
        if (!(Number(form.valorTitulo) > 0)) return fail("Informe o valor do título.");
        return wrap({
          ...base,
          coberturaMeses: undefined,
          provider: providerFinal,
          valorTitulo: Number(form.valorTitulo),
        });
      case "caucao":
        return wrap({
          ...base,
          coberturaMeses: undefined,
          caucaoSubtipo: form.caucaoSubtipo,
          valorCaucao: form.valorCaucao ? Number(form.valorCaucao) : undefined,
          dadosDeposito:
            form.banco || form.agencia || form.conta || form.dataDeposito
              ? {
                  banco: form.banco.trim() || undefined,
                  agencia: form.agencia.trim() || undefined,
                  conta: form.conta.trim() || undefined,
                  dataDeposito: form.dataDeposito || undefined,
                }
              : undefined,
        });
      case "garantia_digital":
        if (providerFinal.length < 2) return fail("Informe o provedor.");
        return wrap({
          ...base,
          provider: providerFinal,
          taxaMensal: form.taxaMensal ? Number(form.taxaMensal) : undefined,
        });
      case "cessao_fiduciaria":
        return wrap({
          ...base,
          coberturaMeses: undefined,
          provider: providerFinal || undefined,
          valorCedido: form.valorCedido ? Number(form.valorCedido) : undefined,
        });
      default:
        return fail("Modalidade inválida.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const built = buildPayload();
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/guarantees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(substituicao ? "Garantia substituída" : "Garantia registrada");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar garantia");
    } finally {
      setSaving(false);
    }
  }

  function ProviderSelect({ options }: { options: string[] }) {
    return (
      <div className="space-y-1">
        <Label>Provedor</Label>
        <Select value={form.provider} onValueChange={(v) => set("provider", v)}>
          <SelectTrigger>
            <SelectValue placeholder="Escolha…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
            <SelectItem value="__outro">Outro…</SelectItem>
          </SelectContent>
        </Select>
        {form.provider === "__outro" && (
          <Input
            placeholder="Nome do provedor"
            value={form.providerOutro}
            onChange={(e) => set("providerOutro", e.target.value)}
          />
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={substituicao ? "outline" : "default"}>
          {substituicao ? (
            <>
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Substituir garantia
            </>
          ) : (
            <>
              <FileCheck className="mr-1.5 h-3.5 w-3.5" /> Contratar garantia
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>
            {substituicao ? "Substituir garantia do contrato" : "Contratar garantia"}
          </DialogTitle>
          <DialogDescription>
            A Lei 8.245 (art. 37) permite apenas UMA modalidade por contrato.
            {substituicao && " A garantia atual vai para o histórico."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Modalidade</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODALIDADES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tipo === "seguro_fianca" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <ProviderSelect options={PROVIDERS_FIANCA} />
              </div>
              <div className="space-y-1">
                <Label>Prêmio mensal (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.premioMensal}
                  onChange={(e) => set("premioMensal", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mercado: ~9–15% do aluguel ({fmtBRL(valorAluguel * 0.09)}–
                  {fmtBRL(valorAluguel * 0.15)}).
                </p>
              </div>
              <div className="space-y-1">
                <Label>Cobertura (meses)</Label>
                <Input
                  type="number"
                  value={form.coberturaMeses}
                  onChange={(e) => set("coberturaMeses", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Planos comuns: 12 ou 18.</p>
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Nº da apólice (opcional)</Label>
                <Input
                  value={form.externalRef}
                  onChange={(e) => set("externalRef", e.target.value)}
                />
              </div>
            </div>
          )}

          {tipo === "fiador" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Nome completo</Label>
                <Input
                  required
                  value={form.fiadorNome}
                  onChange={(e) => set("fiadorNome", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>CPF</Label>
                <Input value={form.fiadorCpf} onChange={(e) => set("fiadorCpf", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Telefone</Label>
                <Input
                  value={form.fiadorTelefone}
                  onChange={(e) => set("fiadorTelefone", e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.fiadorEmail}
                  onChange={(e) => set("fiadorEmail", e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Endereço</Label>
                <Input
                  value={form.fiadorEndereco}
                  onChange={(e) => set("fiadorEndereco", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Profissão</Label>
                <Input
                  value={form.fiadorProfissao}
                  onChange={(e) => set("fiadorProfissao", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Renda mensal (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.fiadorRenda}
                  onChange={(e) => set("fiadorRenda", e.target.value)}
                />
              </div>
            </div>
          )}

          {tipo === "titulo_capitalizacao" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <ProviderSelect options={PROVIDERS_CAP} />
              </div>
              <div className="space-y-1">
                <Label>Valor do título (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  required
                  value={form.valorTitulo}
                  onChange={(e) => set("valorTitulo", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Nº do título</Label>
                <Input
                  value={form.externalRef}
                  onChange={(e) => set("externalRef", e.target.value)}
                />
              </div>
            </div>
          )}

          {tipo === "caucao" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Subtipo</Label>
                <Select value={form.caucaoSubtipo} onValueChange={(v) => set("caucaoSubtipo", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="valor">Valor em dinheiro</SelectItem>
                    <SelectItem value="veiculo">Veículo</SelectItem>
                    <SelectItem value="carta_fianca">Carta fiança</SelectItem>
                    <SelectItem value="imovel">Imóvel</SelectItem>
                    <SelectItem value="outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.valorCaucao}
                  onChange={(e) => set("valorCaucao", e.target.value)}
                />
                {caucaoExcede && (
                  <p className="text-xs text-amber-600">
                    Acima de 3× o aluguel ({fmtBRL(valorAluguel * 3)}) — limite do art. 38 §2º.
                  </p>
                )}
              </div>
              {form.caucaoSubtipo === "valor" && (
                <>
                  <div className="space-y-1">
                    <Label>Banco</Label>
                    <Input value={form.banco} onChange={(e) => set("banco", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Agência</Label>
                    <Input value={form.agencia} onChange={(e) => set("agencia", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Conta</Label>
                    <Input value={form.conta} onChange={(e) => set("conta", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Data do depósito</Label>
                    <Input
                      type="date"
                      value={form.dataDeposito}
                      onChange={(e) => set("dataDeposito", e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {tipo === "garantia_digital" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <ProviderSelect options={PROVIDERS_DIGITAL} />
              </div>
              <div className="space-y-1">
                <Label>Taxa mensal (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.taxaMensal}
                  onChange={(e) => set("taxaMensal", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Cobertura (meses)</Label>
                <Input
                  type="number"
                  value={form.coberturaMeses}
                  onChange={(e) => set("coberturaMeses", e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Referência externa (nº do contrato no provedor)</Label>
                <Input
                  value={form.externalRef}
                  onChange={(e) => set("externalRef", e.target.value)}
                />
              </div>
            </div>
          )}

          {tipo === "cessao_fiduciaria" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Instituição (opcional)</Label>
                <Input
                  value={form.providerOutro}
                  onChange={(e) => {
                    set("provider", "__outro");
                    set("providerOutro", e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Valor cedido (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.valorCedido}
                  onChange={(e) => set("valorCedido", e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>Observações</Label>
            <Input
              placeholder="Opcional"
              value={form.observacoes}
              onChange={(e) => set("observacoes", e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : substituicao ? "Substituir" : "Registrar garantia"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
