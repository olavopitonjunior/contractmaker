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
import { Badge } from "@/components/ui/badge";
import { Plus, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { ImportarClientePicker, type ImportedTenant } from "@/components/locacao/ImportarClientePicker";

interface Option {
  id: string;
  label: string;
  meta?: string;
}

interface Props {
  properties: Option[];
  tenants: Option[];
  /** Modo controlado (dropdown "Novo negócio") — esconde o trigger próprio. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface FormState {
  // Passo 1
  propertyId: string;
  // Passo 2
  tenantIds: string[];
  // Passo 3
  garantiaTipo: string;
  caucaoSubtipo: string;
  garantiaProvider: string;
  // Passo 4
  valorAluguel: string;
  valorEncargos: string;
  diaVencimento: string;
  indiceReajuste: string;
  vigenciaMeses: string;
  regimeIr: string;
  regimeCobranca: string;
  taxaAdminPercent: string;
  emitirNfse: boolean;
  finalidade: string;
}

const STEP_TITLES = [
  "1. Imóvel",
  "2. Locatários",
  "3. Garantia",
  "4. Aluguel & Config",
  "5. Confirmação",
];

const GARANTIA_TIPOS: Record<string, string> = {
  caucionante: "Caucionante",
  caucao: "Caução",
  cessao_fiduciaria: "Cessão fiduciária",
  fiador: "Fiador",
  seguro_fianca: "Seguro-fiança",
  titulo_capitalizacao: "Título de capitalização",
  sem_garantia: "Não possui garantia",
};

const CAUCAO_SUBTIPOS: Record<string, string> = {
  valor: "Valor (3 aluguéis máx, Lei 8.245)",
  veiculo: "Veículo",
  carta_fianca: "Carta-fiança",
  imovel: "Imóvel",
  outros: "Outros",
};

const SEGURO_PROVIDERS = ["credpago", "garantti", "creditas", "porto", "outro"];

const FINALIDADES: Record<string, string> = {
  residencial: "Residencial",
  nao_residencial: "Não residencial",
  comercial: "Comercial",
  industria: "Indústria",
  temporada: "Temporada",
  por_encomenda: "Por encomenda",
  mista: "Mista",
};

const REGIME_IR: Record<string, string> = {
  nao_retem: "Não retém",
  retem_sem_controle: "Retém (sem controle)",
  retem_imobiliaria: "Retém, imobiliária recolhe",
  retem_inquilino: "Retém, inquilino recolhe",
};

export function NovoContratoWizard({
  properties,
  tenants,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => {
    if (isControlled) onOpenChange?.(o);
    else setUncontrolledOpen(o);
  };
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    propertyId: "",
    tenantIds: [],
    garantiaTipo: "sem_garantia",
    caucaoSubtipo: "valor",
    garantiaProvider: "",
    valorAluguel: "",
    valorEncargos: "0",
    diaVencimento: "10",
    indiceReajuste: "IGPM",
    vigenciaMeses: "30",
    regimeIr: "nao_retem",
    regimeCobranca: "mes_a_vencer",
    taxaAdminPercent: "10",
    emitirNfse: false,
    finalidade: "residencial",
  });

  // Locatários importados de clientes cadastrados (convertidos em Tenant). Mesclam
  // com a lista pré-carregada — o wizard nasceu só com os Tenants existentes.
  const [extraTenants, setExtraTenants] = useState<Option[]>([]);
  const allTenants = [...tenants, ...extraTenants];

  function handleImportedTenant(t: ImportedTenant) {
    setExtraTenants((prev) =>
      prev.some((p) => p.id === t.id) || tenants.some((p) => p.id === t.id)
        ? prev
        : [...prev, { id: t.id, label: t.label }]
    );
    setForm((s) => ({
      ...s,
      tenantIds: s.tenantIds.includes(t.id) ? s.tenantIds : [...s.tenantIds, t.id],
    }));
  }

  const propertyLabel = properties.find((p) => p.id === form.propertyId)?.label;
  const tenantLabels = form.tenantIds
    .map((id) => allTenants.find((t) => t.id === id)?.label)
    .filter(Boolean);

  function canAdvance(): boolean {
    if (step === 0) return !!form.propertyId;
    if (step === 1) return form.tenantIds.length > 0;
    if (step === 2) return !!form.garantiaTipo;
    if (step === 3) {
      const v = Number(form.valorAluguel);
      return v > 0 && Number(form.taxaAdminPercent) >= 0;
    }
    return true;
  }

  function toggleTenant(id: string) {
    setForm((s) => ({
      ...s,
      tenantIds: s.tenantIds.includes(id)
        ? s.tenantIds.filter((t) => t !== id)
        : [...s.tenantIds, id],
    }));
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const res = await fetch("/api/locacao/contracts/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: form.propertyId,
          tenantIds: form.tenantIds,
          garantia: {
            tipo: form.garantiaTipo,
            ...(form.garantiaTipo === "caucao" ? { caucaoSubtipo: form.caucaoSubtipo } : {}),
            ...(form.garantiaTipo === "seguro_fianca" ? { provider: form.garantiaProvider } : {}),
          },
          valorAluguel: Number(form.valorAluguel),
          valorEncargos: Number(form.valorEncargos),
          diaVencimento: Number(form.diaVencimento),
          indiceReajuste: form.indiceReajuste,
          vigenciaMeses: Number(form.vigenciaMeses),
          regimeIr: form.regimeIr,
          regimeCobranca: form.regimeCobranca,
          taxaAdminPercent: Number(form.taxaAdminPercent),
          emitirNfse: form.emitirNfse,
          finalidade: form.finalidade,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { dealId: string; stage: string };
      toast.success(`Contrato criado no stage "${data.stage}"`);
      setOpen(false);
      setStep(0);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  // Basta ter imóvel: o locatário pode vir de um cliente cadastrado (import →
  // convert no passo 2), então não exigimos Tenant pré-existente pra abrir.
  const noPropertyOrTenant = properties.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setStep(0);
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="sm" disabled={noPropertyOrTenant}>
            <Plus className="mr-1 h-4 w-4" />
            Novo contrato
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{STEP_TITLES[step]}</DialogTitle>
          <DialogDescription>
            Wizard de criação de contrato de locação (espelha Superlógica). Passo {step + 1} de 5.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper visual */}
        <div className="flex items-center gap-1 text-xs">
          {STEP_TITLES.map((t, i) => (
            <div
              key={i}
              className={`flex-1 rounded px-2 py-1 text-center ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-primary/30 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="inline h-3 w-3" /> : i + 1}
            </div>
          ))}
        </div>

        <div className="min-h-[280px] space-y-3">
          {step === 0 && (
            <div className="space-y-2">
              <Label>Imóvel disponível</Label>
              <Select
                value={form.propertyId}
                onValueChange={(v) => setForm({ ...form, propertyId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um imóvel..." />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Só imóveis com status disponível/anunciado/em_negociacao aparecem.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Locatários (multi-select)</Label>
                <ImportarClientePicker onImported={handleImportedTenant} />
              </div>
              <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-md border p-2">
                {allTenants.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={form.tenantIds.includes(t.id)}
                      onChange={() => toggleTenant(t.id)}
                      className="rounded border-input"
                    />
                    <span className="flex-1">{t.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Selecione um ou mais. Primeiro = titular; demais = solidários (Lei 8.245 art.2).
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <Label>Tipo de garantia</Label>
                <Select
                  value={form.garantiaTipo}
                  onValueChange={(v) => setForm({ ...form, garantiaTipo: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(GARANTIA_TIPOS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.garantiaTipo === "caucao" && (
                <div>
                  <Label>Subtipo de caução</Label>
                  <Select
                    value={form.caucaoSubtipo}
                    onValueChange={(v) => setForm({ ...form, caucaoSubtipo: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CAUCAO_SUBTIPOS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.garantiaTipo === "seguro_fianca" && (
                <div>
                  <Label>Seguradora</Label>
                  <Select
                    value={form.garantiaProvider}
                    onValueChange={(v) => setForm({ ...form, garantiaProvider: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SEGURO_PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Fiador e dados específicos da garantia podem ser preenchidos depois no detalhe.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Aluguel (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.valorAluguel}
                  onChange={(e) => setForm({ ...form, valorAluguel: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Encargos (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.valorEncargos}
                  onChange={(e) => setForm({ ...form, valorEncargos: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Dia venc.</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.diaVencimento}
                  onChange={(e) => setForm({ ...form, diaVencimento: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Taxa adm (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.taxaAdminPercent}
                  onChange={(e) => setForm({ ...form, taxaAdminPercent: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Índice reajuste</Label>
                <Select
                  value={form.indiceReajuste}
                  onValueChange={(v) => setForm({ ...form, indiceReajuste: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IGPM">IGPM</SelectItem>
                    <SelectItem value="IPCA">IPCA</SelectItem>
                    <SelectItem value="IGP-DI">IGP-DI</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Vigência (meses)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.vigenciaMeses}
                  onChange={(e) => setForm({ ...form, vigenciaMeses: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Finalidade</Label>
                <Select
                  value={form.finalidade}
                  onValueChange={(v) => setForm({ ...form, finalidade: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FINALIDADES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Regime IR</Label>
                <Select
                  value={form.regimeIr}
                  onValueChange={(v) => setForm({ ...form, regimeIr: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REGIME_IR).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="emitir-nfse"
                  checked={form.emitirNfse}
                  onChange={(e) => setForm({ ...form, emitirNfse: e.target.checked })}
                />
                <Label htmlFor="emitir-nfse" className="text-sm font-normal">
                  Emitir NFS-e por repasse
                </Label>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-2 text-sm">
              <div className="rounded-md bg-muted/30 p-3 text-xs">
                <div>
                  <strong>Imóvel:</strong> {propertyLabel}
                </div>
                <div>
                  <strong>Locatários:</strong> {tenantLabels.join(", ")}
                </div>
                <div>
                  <strong>Garantia:</strong> {GARANTIA_TIPOS[form.garantiaTipo]}
                  {form.garantiaTipo === "caucao" &&
                    ` · subtipo ${CAUCAO_SUBTIPOS[form.caucaoSubtipo]}`}
                  {form.garantiaTipo === "seguro_fianca" &&
                    form.garantiaProvider &&
                    ` · ${form.garantiaProvider}`}
                </div>
                <div>
                  <strong>Aluguel:</strong> R$ {form.valorAluguel} · encargos R${" "}
                  {form.valorEncargos} · vencimento dia {form.diaVencimento}
                </div>
                <div>
                  <strong>Taxa adm:</strong> {form.taxaAdminPercent}% · índice{" "}
                  {form.indiceReajuste} · vigência {form.vigenciaMeses} meses
                </div>
                <div>
                  <strong>Fiscal:</strong> {FINALIDADES[form.finalidade]} ·{" "}
                  {REGIME_IR[form.regimeIr]} · NFS-e:{" "}
                  {form.emitirNfse ? "sim" : "não"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Após criar, o negócio entra no Pipeline de Locação (stage &quot;Formulário&quot;) e
                pode ser editado a qualquer momento na ficha do contrato.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex !justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || saving}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Anterior
          </Button>
          {step < 4 ? (
            <Button
              size="sm"
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={!canAdvance()}
            >
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? "Criando..." : "Criar contrato"}
              <Check className="ml-1 h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
