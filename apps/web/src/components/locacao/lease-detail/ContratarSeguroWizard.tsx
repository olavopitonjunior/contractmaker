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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield } from "lucide-react";

interface Props {
  leaseContractId: string;
  valorAluguel: number;
}

const SEGURADORAS = ["Porto Seguro", "Tokio Marine", "Pottencial", "Too Seguros"];

const ADICIONAIS: Array<{ key: string; label: string }> = [
  { key: "vendaval", label: "Vendaval" },
  { key: "danos_eletricos", label: "Danos elétricos" },
  { key: "responsabilidade_civil", label: "Responsabilidade civil" },
  { key: "perda_aluguel", label: "Perda de aluguel" },
];

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isoPlusMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function ContratarSeguroWizard({ leaseContractId, valorAluguel }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    coberturaValor: String(Math.round(valorAluguel * 100)),
    adicionais: [] as string[],
    seguradora: SEGURADORAS[0],
    seguradoraOutra: "",
    premioMensal: "",
    vigenciaInicio: new Date().toISOString().slice(0, 10),
    vigenciaFim: isoPlusMonths(12),
    responsavelPagamento: "locatario",
    apoliceNumero: "",
    gerarDespesa: false,
  });

  const seguradoraFinal =
    form.seguradora === "__outra" ? form.seguradoraOutra.trim() : form.seguradora;
  const premio = Number(form.premioMensal) || 0;
  const podeGerarDespesa = premio > 0 && form.responsavelPagamento !== "imobiliaria";

  function reset() {
    setStep(0);
  }

  function toggleAdicional(key: string) {
    setForm((f) => ({
      ...f,
      adicionais: f.adicionais.includes(key)
        ? f.adicionais.filter((a) => a !== key)
        : [...f.adicionais, key],
    }));
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseContractId,
          tipo: "seguro_incendio",
          seguradora: seguradoraFinal,
          apoliceNumero: form.apoliceNumero.trim() || undefined,
          vigenciaInicio: form.vigenciaInicio,
          vigenciaFim: form.vigenciaFim,
          premioMensal: premio > 0 ? premio : undefined,
          responsavelPagamento: form.responsavelPagamento,
          coberturaJson: {
            coberturaValor: Number(form.coberturaValor) || undefined,
            adicionais: form.adicionais,
          },
          gerarDespesa: form.gerarDespesa && podeGerarDespesa,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(
        data.despesasGeradas > 0
          ? `Seguro registrado — ${data.despesasGeradas} despesa(s) mensal(is) gerada(s)`
          : "Seguro registrado"
      );
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao contratar seguro");
    } finally {
      setSaving(false);
    }
  }

  const stepValid =
    step === 0
      ? Number(form.coberturaValor) > 0
      : step === 1
        ? seguradoraFinal.length >= 2 && form.vigenciaInicio < form.vigenciaFim
        : true;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Shield className="mr-1.5 h-3.5 w-3.5" />
          Contratar seguro incêndio
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Contratar seguro incêndio</DialogTitle>
          <DialogDescription>
            {step === 0 && "Etapa 1 de 3 — cobertura desejada"}
            {step === 1 && "Etapa 2 de 3 — dados da cotação"}
            {step === 2 && "Etapa 3 de 3 — revisão"}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Valor de cobertura (R$)</Label>
              <Input
                type="number"
                step="1000"
                value={form.coberturaValor}
                onChange={(e) => setForm({ ...form, coberturaValor: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Sugestão de mercado: 100× o aluguel ({fmtBRL(valorAluguel * 100)}).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Coberturas básicas (incluídas)</Label>
              <p className="text-sm text-muted-foreground">Incêndio · Raio · Explosão</p>
            </div>
            <div className="space-y-2">
              <Label>Coberturas adicionais</Label>
              <div className="grid grid-cols-2 gap-2">
                {ADICIONAIS.map((a) => (
                  <label key={a.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={form.adicionais.includes(a.key)}
                      onChange={() => toggleAdicional(a.key)}
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Seguradora</Label>
              <Select
                value={form.seguradora}
                onValueChange={(v) => setForm({ ...form, seguradora: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEGURADORAS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                  <SelectItem value="__outra">Outra…</SelectItem>
                </SelectContent>
              </Select>
              {form.seguradora === "__outra" && (
                <Input
                  placeholder="Nome da seguradora"
                  value={form.seguradoraOutra}
                  onChange={(e) => setForm({ ...form, seguradoraOutra: e.target.value })}
                />
              )}
            </div>
            <div className="space-y-1">
              <Label>Prêmio mensal (R$)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="ex.: 45,00"
                value={form.premioMensal}
                onChange={(e) => setForm({ ...form, premioMensal: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Responsável pelo pagamento</Label>
              <Select
                value={form.responsavelPagamento}
                onValueChange={(v) => setForm({ ...form, responsavelPagamento: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="locatario">Locatário</SelectItem>
                  <SelectItem value="proprietario">Proprietário</SelectItem>
                  <SelectItem value="imobiliaria">Imobiliária</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Lei 8.245 art. 22: do locador, transferível ao locatário por cláusula.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Início da vigência</Label>
              <Input
                type="date"
                value={form.vigenciaInicio}
                onChange={(e) => setForm({ ...form, vigenciaInicio: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Fim da vigência</Label>
              <Input
                type="date"
                value={form.vigenciaFim}
                onChange={(e) => setForm({ ...form, vigenciaFim: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Nº da apólice (se já emitida)</Label>
              <Input
                placeholder="Deixe vazio para registrar como cotação"
                value={form.apoliceNumero}
                onChange={(e) => setForm({ ...form, apoliceNumero: e.target.value })}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <p>
                <strong>{seguradoraFinal}</strong> · cobertura{" "}
                {fmtBRL(Number(form.coberturaValor) || 0)}
              </p>
              <p className="text-muted-foreground">
                Incêndio, raio, explosão
                {form.adicionais.length > 0 &&
                  ` + ${form.adicionais
                    .map((a) => ADICIONAIS.find((x) => x.key === a)?.label ?? a)
                    .join(", ")}`}
              </p>
              <p className="text-muted-foreground">
                Vigência {form.vigenciaInicio} → {form.vigenciaFim} · prêmio{" "}
                {premio > 0 ? `${fmtBRL(premio)}/mês` : "a cotar"} · paga:{" "}
                {form.responsavelPagamento}
              </p>
              <p className="text-muted-foreground">
                {form.apoliceNumero
                  ? `Apólice ${form.apoliceNumero} — entra como ATIVA`
                  : "Sem nº de apólice — entra como COTAÇÃO"}
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="font-medium">Gerar despesa mensal</p>
                <p className="text-xs text-muted-foreground">
                  Cria 1 despesa por mês de vigência (entra no boleto do{" "}
                  {form.responsavelPagamento === "proprietario" ? "proprietário" : "locatário"}).
                </p>
              </div>
              <Switch
                checked={form.gerarDespesa && podeGerarDespesa}
                disabled={!podeGerarDespesa}
                onCheckedChange={(v) => setForm({ ...form, gerarDespesa: v })}
              />
            </label>
            {!podeGerarDespesa && (
              <p className="text-xs text-muted-foreground">
                Despesa mensal exige prêmio &gt; 0 e pagamento pelo locatário ou proprietário.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)} disabled={saving}>
              Voltar
            </Button>
          )}
          {step < 2 ? (
            <Button type="button" onClick={() => setStep(step + 1)} disabled={!stepValid}>
              Avançar
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={saving}>
              {saving ? "Registrando…" : "Confirmar contratação"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
