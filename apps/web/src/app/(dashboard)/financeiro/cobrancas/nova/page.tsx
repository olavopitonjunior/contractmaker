"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ArrowRight, CheckCircle2, Plus, Search } from "lucide-react";
import { maskCpfCnpj } from "@/lib/security/pii";
import SplitEditor, {
  type SplitEntry,
  toApiSplit,
} from "@/components/financeiro/SplitEditor";

interface Customer {
  id: string;
  name: string;
  cpfCnpj: string;
  email: string | null;
}

type Step = "payer" | "charge" | "review";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function NovaCobrancaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("payer");

  // Payer state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: "",
    cpfCnpj: "",
    email: "",
    mobilePhone: "",
  });
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Charge state
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 7);
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO">("PIX");
  const [value, setValue] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue.toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"avulsa" | "aluguel" | "outros">("avulsa");

  // Split state
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splits, setSplits] = useState<SplitEntry[]>([]);
  const [platformFeePercent, setPlatformFeePercent] = useState(0);

  const [submitting, setSubmitting] = useState(false);

  // Carrega platform fee uma vez pra mostrar no SplitEditor
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/financeiro/settings", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setPlatformFeePercent(data.settings?.platformFeePercent ?? 0);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/financeiro/customers?${params}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.rows);
      }
    })();
  }, [search]);

  async function createCustomer() {
    setCreatingCustomer(true);
    try {
      const res = await fetch("/api/financeiro/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newCustomerForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        return;
      }
      setSelectedCustomer(data.customer);
      setShowNewForm(false);
      toast.success("Cliente criado");
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function submit() {
    if (!selectedCustomer) return;
    setSubmitting(true);
    try {
      const apiSplits = splitEnabled ? toApiSplit(splits) : [];
      const res = await fetch("/api/financeiro/charges/nova", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          billingType,
          value: parseFloat(value),
          dueDate,
          description: description || undefined,
          kind,
          customSplits: apiSplits.length > 0 ? apiSplits : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.message ??
          data.details?.[0]?.description ??
          data.error ??
          "Falha";
        toast.error(msg);
        return;
      }
      toast.success("Cobrança gerada");
      router.push(`/financeiro/cobrancas/${data.charge.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  const canAdvanceFromPayer = !!selectedCustomer;
  const canAdvanceFromCharge =
    parseFloat(value) > 0 && !!dueDate && !!billingType;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/financeiro/cobrancas">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">Nova cobrança avulsa</h1>
        <p className="text-sm text-muted-foreground">
          Cobrança sem vínculo com deal ou contrato específico.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        <StepPill active={step === "payer"} done={step !== "payer"} label="1. Pagador" />
        <StepPill
          active={step === "charge"}
          done={step === "review"}
          label="2. Cobrança"
        />
        <StepPill active={step === "review"} done={false} label="3. Revisão" />
      </div>

      {/* STEP 1: Payer */}
      {step === "payer" && (
        <Card>
          <CardHeader>
            <CardTitle>Quem vai pagar?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!showNewForm && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome ou CPF/CNPJ..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="border rounded max-h-[300px] overflow-y-auto">
                  {customers.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground text-center">
                      Nenhum cliente encontrado
                    </p>
                  )}
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCustomer(c)}
                      className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-muted transition ${
                        selectedCustomer?.id === c.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {maskCpfCnpj(c.cpfCnpj)}
                        {c.email ? ` · ${c.email}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewForm(true)}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-1" /> Cadastrar novo cliente
                </Button>
              </>
            )}

            {showNewForm && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="nc-name">Nome</Label>
                  <Input
                    id="nc-name"
                    value={newCustomerForm.name}
                    onChange={(e) =>
                      setNewCustomerForm({ ...newCustomerForm, name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="nc-cpf">CPF/CNPJ</Label>
                  <Input
                    id="nc-cpf"
                    value={newCustomerForm.cpfCnpj}
                    onChange={(e) =>
                      setNewCustomerForm({ ...newCustomerForm, cpfCnpj: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="nc-email">Email</Label>
                  <Input
                    id="nc-email"
                    type="email"
                    value={newCustomerForm.email}
                    onChange={(e) =>
                      setNewCustomerForm({ ...newCustomerForm, email: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="nc-phone">Celular</Label>
                  <Input
                    id="nc-phone"
                    value={newCustomerForm.mobilePhone}
                    onChange={(e) =>
                      setNewCustomerForm({ ...newCustomerForm, mobilePhone: e.target.value })
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowNewForm(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={createCustomer}
                    disabled={
                      creatingCustomer ||
                      !newCustomerForm.name ||
                      !newCustomerForm.cpfCnpj
                    }
                    className="flex-1"
                  >
                    {creatingCustomer ? "Criando..." : "Criar cliente"}
                  </Button>
                </div>
              </div>
            )}

            {selectedCustomer && !showNewForm && (
              <div className="p-3 border rounded bg-green-50 border-green-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{selectedCustomer.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {maskCpfCnpj(selectedCustomer.cpfCnpj)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedCustomer(null)}
                  >
                    Trocar
                  </Button>
                </div>
              </div>
            )}

            <Button
              onClick={() => setStep("charge")}
              disabled={!canAdvanceFromPayer}
              className="w-full"
            >
              Próximo <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Charge data */}
      {step === "charge" && (
        <Card>
          <CardHeader>
            <CardTitle>Dados da cobrança</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-2 block">Método</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["PIX", "BOLETO"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`border rounded-md p-3 text-sm font-medium transition ${
                      billingType === m
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-muted"
                    }`}
                    onClick={() => setBillingType(m)}
                  >
                    {m === "PIX" ? "PIX" : "Boleto"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="nv-val">Valor</Label>
              <Input
                id="nv-val"
                type="number"
                step="0.01"
                min="1"
                placeholder="0,00"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="nv-due">Vencimento</Label>
              <Input
                id="nv-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <Label htmlFor="nv-kind">Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as any)}>
                <SelectTrigger id="nv-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="avulsa">Avulsa</SelectItem>
                  <SelectItem value="aluguel">Aluguel</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="nv-desc">Descrição (opcional)</Label>
              <Input
                id="nv-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Aluguel abril/2026"
                maxLength={500}
              />
            </div>

            <div className="border-t pt-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={splitEnabled}
                  onChange={(e) => {
                    setSplitEnabled(e.target.checked);
                    if (!e.target.checked) setSplits([]);
                  }}
                />
                <span className="text-sm font-medium">
                  Aplicar split de pagamento
                </span>
                {platformFeePercent > 0 && (
                  <Badge variant="outline" className="text-xs">
                    +{platformFeePercent}% plataforma auto
                  </Badge>
                )}
              </label>
              <p className="text-xs text-muted-foreground">
                Divida este recebimento entre múltiplas wallets Asaas (corretora,
                vendedor, etc.). Cadastre destinatários em{" "}
                <Link
                  href="/settings/pagamentos/split-recipients"
                  className="underline"
                  target="_blank"
                >
                  Configurações → Destinatários de split
                </Link>
                .
              </p>
              {splitEnabled && (
                <SplitEditor
                  value={splits}
                  onChange={setSplits}
                  platformFeePercent={platformFeePercent}
                  chargeValue={parseFloat(value || "0")}
                />
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("payer")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={() => setStep("review")}
                disabled={!canAdvanceFromCharge}
                className="flex-1"
              >
                Próximo <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Review */}
      {step === "review" && selectedCustomer && (
        <Card>
          <CardHeader>
            <CardTitle>Revisão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Pagador:</span>{" "}
                {selectedCustomer.name} ({maskCpfCnpj(selectedCustomer.cpfCnpj)})
              </div>
              <div>
                <span className="text-muted-foreground">Método:</span>{" "}
                <Badge variant="outline">{billingType}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Valor:</span>{" "}
                <strong>{fmtBRL(parseFloat(value || "0"))}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Vencimento:</span>{" "}
                {new Date(dueDate).toLocaleDateString("pt-BR")}
              </div>
              <div>
                <span className="text-muted-foreground">Tipo:</span> {kind}
              </div>
              {description && (
                <div>
                  <span className="text-muted-foreground">Descrição:</span>{" "}
                  {description}
                </div>
              )}
            </div>

            {splitEnabled && splits.length > 0 && (
              <div className="border-t pt-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  Split de pagamento
                </div>
                {splits
                  .filter(
                    (s) => s.walletId.trim() !== "" && s.percentualValue > 0
                  )
                  .map((s) => (
                    <div
                      key={s.key}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{s.label || s.walletId}</span>
                      <Badge variant="outline">
                        {s.percentualValue}% ·{" "}
                        {fmtBRL(
                          (parseFloat(value || "0") * s.percentualValue) / 100
                        )}
                      </Badge>
                    </div>
                  ))}
                {platformFeePercent > 0 && (
                  <div className="flex items-center justify-between text-sm text-amber-900">
                    <span>Plataforma (automático)</span>
                    <Badge variant="outline">
                      {platformFeePercent}% ·{" "}
                      {fmtBRL(
                        (parseFloat(value || "0") * platformFeePercent) / 100
                      )}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("charge")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={submit}
                disabled={submitting}
                className="flex-1"
              >
                {submitting ? "Gerando..." : "Gerar cobrança"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepPill({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div
      className={`px-3 py-1 rounded-full text-xs font-medium ${
        active
          ? "bg-primary text-primary-foreground"
          : done
          ? "bg-green-100 text-green-900 border border-green-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {done && <CheckCircle2 className="h-3 w-3 inline mr-1" />}
      {label}
    </div>
  );
}
