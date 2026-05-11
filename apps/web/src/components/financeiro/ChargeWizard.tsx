"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Plus,
  Search,
  AlertTriangle,
  Lightbulb,
  EyeOff,
  HelpCircle,
} from "lucide-react";
import { maskCpfCnpj } from "@/lib/security/pii";
import { DataOriginDrawer } from "@/components/financeiro/DataOriginDrawer";
import { checkBusinessDay } from "@/lib/financeiro/businessDay";
import SplitEditor, {
  type SplitEntry,
  toApiSplit,
  toApiDisplay,
} from "@/components/financeiro/SplitEditor";

export type ChargeWizardMode =
  | "commission_from_deal"
  | "avulsa_in_deal"
  | "avulsa_standalone";

interface PartySummary {
  papel: "comprador" | "vendedor";
  index: number;
  nome: string;
  cpfCnpj: string;
  email: string | null;
  mobilePhone: string | null;
}

type ComissionadoSource =
  | "ccv.comissionados"
  | "ccv.imobiliaria_principal"
  | "manual";

interface SummaryComissionado {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: "fisica" | "juridica";
  percentual?: number;
  valor?: number;
  email?: string;
  mobile_phone?: string;
  creci?: string;
  papel?: string;
  source?: ComissionadoSource;
  splitRecipientId?: string | null;
  matchedBy?: "cpf_cnpj" | "name" | null;
}

interface DealSummary {
  deal: { id: string; title: string };
  contract: { id: string; status: string; isImported: boolean } | null;
  parties: PartySummary[];
  comissionados: SummaryComissionado[];
  suggestedPayer: PartySummary | null;
  payerError: string | null;
  suggestedValue: number | null;
  suggestedDueDate: { iso: string; reason: string };
  formaPagamentoPreferida: "pix" | "boleto" | "qualquer";
  modalidade: string | null;
}

const SOURCE_LABEL: Record<ComissionadoSource, string> = {
  "ccv.comissionados": "extraído do contrato (lista explícita)",
  "ccv.imobiliaria_principal": "extraído do contrato (corretora principal)",
  manual: "adicionado manualmente",
};

const QUEM_PAGA_LABEL: Record<string, string> = {
  comprador: "comprador paga a comissão",
  vendedor: "vendedor paga a comissão",
  ambos: "ambos pagam a comissão (50/50)",
};

interface CustomerSummary {
  id: string;
  name: string;
  cpfCnpj: string;
  email: string | null;
}

type Step = "payer" | "charge" | "splits" | "review";

interface Props {
  mode: ChargeWizardMode;
  /** Obrigatório nos modes commission_from_deal e avulsa_in_deal. */
  dealId?: string;
  onCreated: (charge: { id: string }) => void;
  onCancel?: () => void;
  /**
   * Permite trocar de mode em runtime preservando state. Usado pelo CTA
   * "Trocar para cobrança avulsa" quando contrato não tem comissionados.
   */
  onModeChange?: (mode: ChargeWizardMode) => void;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDueDate(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

type StepStatus = "pending" | "ok" | "warning" | "blocking";

function StepPill({
  active,
  done,
  status = "pending",
  badgeCount,
  label,
}: {
  active: boolean;
  done: boolean;
  status?: StepStatus;
  badgeCount?: number;
  label: string;
}) {
  const cls = active
    ? "bg-primary text-primary-foreground"
    : status === "blocking"
      ? "bg-red-100 text-red-900 border border-red-300"
      : status === "warning"
        ? "bg-amber-100 text-amber-900 border border-amber-300"
        : status === "ok" || done
          ? "bg-green-100 text-green-900 border border-green-300"
          : "bg-muted text-muted-foreground";
  const icon =
    status === "blocking" ? (
      <AlertTriangle className="h-3 w-3 inline mr-1" />
    ) : status === "warning" ? (
      <AlertTriangle className="h-3 w-3 inline mr-1" />
    ) : status === "ok" || done ? (
      <CheckCircle2 className="h-3 w-3 inline mr-1" />
    ) : null;
  return (
    <div className={`px-3 py-1 rounded-full text-xs font-medium ${cls}`}>
      {icon}
      {label}
      {status === "blocking" && badgeCount !== undefined && badgeCount > 0 && (
        <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold">
          {badgeCount}
        </span>
      )}
    </div>
  );
}

export default function ChargeWizard({ mode, dealId, onCreated, onCancel, onModeChange }: Props) {
  const isAvulsa = mode !== "commission_from_deal";
  const isAvulsaInDeal = mode === "avulsa_in_deal";
  const isAvulsaStandalone = mode === "avulsa_standalone";
  const [step, setStep] = useState<Step>("payer");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [resumePromptShown, setResumePromptShown] = useState(false);
  const [originDrawerOpen, setOriginDrawerOpen] = useState(false);

  // ---------- Deal summary (modes deal-bound) ----------
  const [summary, setSummary] = useState<DealSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!dealId) return;
    (async () => {
      try {
        // 1) Tenta retomar rascunho (commission_from_deal | avulsa_in_deal)
        if (!isAvulsaStandalone && !resumePromptShown) {
          const dRes = await fetch(
            `/api/deals/${dealId}/commission-charges/draft`,
            { credentials: "include" }
          );
          if (dRes.ok) {
            const { draft } = await dRes.json();
            if (draft?.state) {
              const s = draft.state as Record<string, unknown>;
              if (typeof s.selectedPartyKey === "string") setSelectedPartyKey(s.selectedPartyKey);
              if (typeof s.payerName === "string") setPayerName(s.payerName);
              if (typeof s.payerCpfCnpj === "string") setPayerCpfCnpj(s.payerCpfCnpj);
              if (typeof s.payerEmail === "string") setPayerEmail(s.payerEmail);
              if (typeof s.payerPhone === "string") setPayerPhone(s.payerPhone);
              if (s.billingType === "PIX" || s.billingType === "BOLETO") setBillingType(s.billingType);
              if (typeof s.value === "string") setValue(s.value);
              if (typeof s.dueDate === "string") setDueDate(s.dueDate);
              if (typeof s.description === "string") setDescription(s.description);
              if (s.kind === "avulsa" || s.kind === "aluguel" || s.kind === "outros") setKind(s.kind);
              if (typeof s.categoryLabel === "string") setCategoryLabel(s.categoryLabel);
              if (typeof s.accountId === "string") setAccountId(s.accountId);
              if (Array.isArray(s.splits)) setSplits(s.splits as SplitEntry[]);
              if (s.step === "payer" || s.step === "charge" || s.step === "splits" || s.step === "review") setStep(s.step);
              setDraftLoaded(true);
              setResumePromptShown(true);
              toast.info(
                `Continuando rascunho de ${new Date(draft.updatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
              );
            }
          }
        }

        // 2) Carrega summary do contrato
        const res = await fetch(
          `/api/deals/${dealId}/contract-data-summary`,
          { credentials: "include" }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSummaryError(data.error ?? `Erro ${res.status}`);
          return;
        }
        const data = (await res.json()) as DealSummary;
        setSummary(data);
        // Aplica defaults APENAS quando não veio rascunho
        if (!draftLoaded) {
          if (data.suggestedPayer) {
            setSelectedPartyKey(
              `${data.suggestedPayer.papel}-${data.suggestedPayer.index}`
            );
            applyPartyToForm(data.suggestedPayer);
          }
          if (data.suggestedValue) setValue(String(data.suggestedValue));
          if (data.suggestedDueDate.iso) setDueDate(data.suggestedDueDate.iso);
          if (data.formaPagamentoPreferida === "pix") setBillingType("PIX");
          else if (data.formaPagamentoPreferida === "boleto") setBillingType("BOLETO");
        }
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : "Erro ao carregar");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  // ---------- Payer state ----------
  // Standalone usa AsaasCustomer; deal-bound usa parties + override inline
  const [selectedPartyKey, setSelectedPartyKey] = useState<string>("");
  const [payerName, setPayerName] = useState("");
  const [payerCpfCnpj, setPayerCpfCnpj] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [payerPhone, setPayerPhone] = useState("");

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: "",
    cpfCnpj: "",
    email: "",
    mobilePhone: "",
  });
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  function applyPartyToForm(p: PartySummary) {
    setPayerName(p.nome);
    setPayerCpfCnpj(p.cpfCnpj);
    setPayerEmail(p.email ?? "");
    setPayerPhone(p.mobilePhone ?? "");
  }

  function pickPartyByKey(key: string) {
    setSelectedPartyKey(key);
    if (!summary) return;
    const found = summary.parties.find((p) => `${p.papel}-${p.index}` === key);
    if (found) applyPartyToForm(found);
  }

  useEffect(() => {
    if (!isAvulsaStandalone) return;
    (async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/financeiro/customers?${params}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.rows ?? []);
      }
    })();
  }, [search, isAvulsaStandalone]);

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

  // ---------- Charge state ----------
  const defaultDue = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO">("PIX");
  const [value, setValue] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"avulsa" | "aluguel" | "outros">("avulsa");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);

  // Carrega categorias sugeridas pra avulsas
  useEffect(() => {
    if (!isAvulsa) return;
    (async () => {
      const params = new URLSearchParams();
      if (categoryLabel) params.set("q", categoryLabel);
      const res = await fetch(`/api/financeiro/categories?${params}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setCategoryOptions(data.categories ?? []);
      }
    })();
  }, [categoryLabel, isAvulsa]);

  // ---------- Splits state ----------
  const [splits, setSplits] = useState<SplitEntry[]>([]);
  const [platformFeePercent, setPlatformFeePercent] = useState(0);

  // ---------- Account state (multi-account) ----------
  // Lista de contas Asaas accessíveis ao user com cap create_charge.
  // Owner sempre vê dropdown; non-owner vê só a conta ativa (label fixo).
  interface AccountOption {
    id: string;
    label: string | null;
    walletIdMasked: string;
    isActive: boolean;
    status: string;
  }
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/financeiro/accounts", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        const opts: AccountOption[] = (data.accounts ?? [])
          .filter((a: { status: string }) => a.status === "APPROVED")
          .map((a: AccountOption) => a);
        setAccounts(opts);
        // Default: ativa do user; fallback primeira
        const initial =
          opts.find((a) => a.isActive)?.id ?? opts[0]?.id ?? "";
        // Não sobrescreve se draft já trouxe accountId
        setAccountId((prev) => prev || initial);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    // Settings agora é per-conta — refazer fetch quando troca account
    if (!accountId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/financeiro/settings?accountId=${accountId}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          setPlatformFeePercent(data.settings?.platformFeePercent ?? 0);
        }
      } catch {}
    })();
  }, [accountId]);

  const [submitting, setSubmitting] = useState(false);

  async function saveDraft() {
    if (!dealId || isAvulsaStandalone) return;
    setSavingDraft(true);
    try {
      const state = {
        selectedPartyKey, payerName, payerCpfCnpj, payerEmail, payerPhone,
        billingType, value, dueDate, description, kind, categoryLabel, splits, step,
        accountId,
      };
      const res = await fetch(`/api/deals/${dealId}/commission-charges/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ state }),
      });
      if (!res.ok) {
        toast.error("Falha ao salvar rascunho");
        return;
      }
      toast.success("Rascunho salvo (válido por 30 dias)");
      onCancel?.();
    } finally {
      setSavingDraft(false);
    }
  }

  async function discardDraft() {
    if (!dealId || isAvulsaStandalone) return;
    await fetch(`/api/deals/${dealId}/commission-charges/draft`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {});
  }

  async function submit() {
    setSubmitting(true);
    try {
      const apiSplits = toApiSplit(splits);
      const display =
        apiSplits.length > 0 ? toApiDisplay(splits) : undefined;
      const hasDisplay = display && display.hiddenRecipientIds.length > 0;

      if (mode === "commission_from_deal" && dealId) {
        const partyIndex = (() => {
          if (!selectedPartyKey || !summary) return undefined;
          const p = summary.parties.find(
            (x) => `${x.papel}-${x.index}` === selectedPartyKey
          );
          return p?.index;
        })();
        const papel = summary?.parties.find(
          (x) => `${x.papel}-${x.index}` === selectedPartyKey
        )?.papel;
        const res = await fetch(
          `/api/deals/${dealId}/commission-charges`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              billingType,
              dueDate,
              accountId: accountId || undefined,
              contractId: summary?.contract?.id,
              description: description || undefined,
              customSplits: apiSplits.length > 0 ? apiSplits : undefined,
              payerOverride: {
                papel,
                partyIndex,
                nome: payerName,
                cpfCnpj: payerCpfCnpj,
                email: payerEmail || null,
                mobilePhone: payerPhone || null,
              },
              valueOverride: parseFloat(value) || undefined,
              display: hasDisplay ? display : undefined,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          const msg =
            data.error === "ASAAS_ERROR" && data.details?.[0]?.description
              ? data.details[0].description
              : data.message ?? data.error ?? `HTTP ${res.status}`;
          toast.error(msg);
          return;
        }
        toast.success("Cobrança gerada");
        await discardDraft();
        onCreated(data.charge);
        return;
      }

      // Avulsas (in_deal ou standalone) → /api/financeiro/charges/nova
      // Em avulsa_in_deal o pagador vem do summary pra criar AsaasCustomer
      // se ainda não existir; em avulsa_standalone vem do customer já selecionado.
      let customerId = selectedCustomer?.id ?? "";
      if (isAvulsaInDeal && !customerId && payerCpfCnpj) {
        // Cria/recupera customer com base nos dados do payer-override.
        // Multi-account: customer é per-conta; passa accountId pro upsert.
        const res = await fetch("/api/financeiro/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            accountId: accountId || undefined,
            name: payerName,
            cpfCnpj: payerCpfCnpj,
            email: payerEmail || undefined,
            mobilePhone: payerPhone || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(
            data.details?.[0]?.description ?? data.error ?? "Falha ao criar cliente"
          );
          return;
        }
        customerId = data.customer.id;
      }

      const res = await fetch("/api/financeiro/charges/nova", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accountId: accountId || undefined,
          customerId,
          billingType,
          value: parseFloat(value),
          dueDate,
          description: description || undefined,
          kind,
          categoryLabel: categoryLabel || undefined,
          dealId: isAvulsaInDeal ? dealId : undefined,
          customSplits: apiSplits.length > 0 ? apiSplits : undefined,
          display: hasDisplay ? display : undefined,
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
      await discardDraft();
      onCreated(data.charge);
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- Validation gates ----------
  const payerReady = isAvulsaStandalone
    ? !!selectedCustomer
    : payerName.trim().length > 0 && payerCpfCnpj.replace(/\D/g, "").length >= 11;

  const chargeReady =
    parseFloat(value) > 0 &&
    !!dueDate &&
    !!billingType &&
    (mode === "commission_from_deal" || categoryLabel.trim().length > 0);

  // Em commission_from_deal, splits têm que ter 0 linhas com "noMatch + sourceComissionado"
  const blockingNoMatch = useMemo(() => {
    if (mode !== "commission_from_deal") return 0;
    return splits.filter(
      (s) =>
        s.percentualValue > 0 &&
        s.sourceComissionado &&
        !s.recipientId &&
        s.walletId.trim() === "" &&
        s.pixAddressKey.trim() === ""
    ).length;
  }, [splits, mode]);

  // ---------- Step status (chips stateful) ----------
  // Computa em paralelo assim que summary chega — operador vê problemas
  // de etapas posteriores antes de chegar lá.
  const payerStatus: StepStatus = !payerReady
    ? "blocking"
    : !payerEmail && billingType === "PIX" && mode !== "avulsa_standalone"
      ? "warning"
      : "ok";
  const chargeStatus: StepStatus = !chargeReady ? "blocking" : "ok";
  const splitsStatus: StepStatus =
    mode !== "commission_from_deal"
      ? "ok"
      : !summary
        ? "pending"
        : summary.comissionados.length === 0
          ? "warning"
          : blockingNoMatch > 0
            ? "blocking"
            : "ok";
  const reviewStatus: StepStatus =
    payerStatus === "blocking" ||
    chargeStatus === "blocking" ||
    splitsStatus === "blocking"
      ? "blocking"
      : payerStatus === "warning" || splitsStatus === "warning"
        ? "warning"
        : "ok";

  // ---------- Render ----------
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {onCancel && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Cancelar
          </Button>
          <div className="flex items-center gap-2">
            {!isAvulsaStandalone && summary && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOriginDrawerOpen(true)}
                title="De onde vieram esses valores?"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            )}
            {!isAvulsaStandalone && dealId && (
              <Button
                variant="outline"
                size="sm"
                onClick={saveDraft}
                disabled={savingDraft}
              >
                {savingDraft ? "Salvando..." : "Salvar rascunho"}
              </Button>
            )}
          </div>
        </div>
      )}

      {summary && (
        <DataOriginDrawer
          open={originDrawerOpen}
          onOpenChange={setOriginDrawerOpen}
          payerName={payerName}
          payerCpfCnpj={payerCpfCnpj}
          payerOrigem={
            summary.suggestedPayer
              ? `dataJson.${summary.suggestedPayer.papel}es[${summary.suggestedPayer.index}] · regra comissao.quem_paga`
              : "manual"
          }
          valor={value ? `R$ ${parseFloat(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}
          valorOrigem={
            summary.suggestedValue !== null
              ? `comissao.valor (R$ ${summary.suggestedValue.toLocaleString("pt-BR")})`
              : "comissao.percentual × pagamento.valor_total"
          }
          vencimento={fmtDueDate(dueDate)}
          vencimentoReason={summary.suggestedDueDate.reason}
          comissionados={summary.comissionados}
        />
      )}

      <div>
        <h1 className="text-xl font-semibold">
          {mode === "commission_from_deal"
            ? "Cobrança de comissão"
            : isAvulsaInDeal
              ? "Cobrança avulsa neste deal"
              : "Nova cobrança avulsa"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "commission_from_deal"
            ? "Pagador, valor e splits são pré-preenchidos a partir do contrato aprovado."
            : isAvulsaInDeal
              ? "Cobrança vinculada a este deal mas sem relação com o contrato (ex: reembolso, honorários)."
              : "Cobrança sem vínculo a deal específico."}
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm flex-wrap">
        <StepPill
          active={step === "payer"}
          done={step !== "payer"}
          status={payerStatus}
          label="1. Pagador"
        />
        <StepPill
          active={step === "charge"}
          done={step === "splits" || step === "review"}
          status={chargeStatus}
          label="2. Cobrança"
        />
        {mode === "commission_from_deal" && (
          <StepPill
            active={step === "splits"}
            done={step === "review"}
            status={splitsStatus}
            badgeCount={blockingNoMatch}
            label="3. Splits"
          />
        )}
        <StepPill
          active={step === "review"}
          done={false}
          status={reviewStatus}
          label={mode === "commission_from_deal" ? "4. Revisão" : "3. Revisão"}
        />
      </div>

      {summaryError && (
        <div className="border rounded p-3 bg-red-50 text-sm text-red-900 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            Erro ao carregar dados do contrato: {summaryError}
          </div>
        </div>
      )}

      {/* Banners contextuais — 1 linha cada, só sinal + ação */}
      {summary && mode === "commission_from_deal" && (() => {
        const banners: Array<{ color: "yellow" | "red"; body: React.ReactNode }> = [];

        if (
          summary.comissionados.length === 1 &&
          summary.comissionados[0].source === "ccv.imobiliaria_principal"
        ) {
          banners.push({
            color: "yellow",
            body: (
              <>
                Apenas 1 corretora ({summary.comissionados[0].nome ?? "—"}). Se houver
                co-corretagem, adicione destinatários abaixo.
              </>
            ),
          });
        }

        if (!payerEmail && billingType === "PIX" && payerName.trim().length > 0) {
          banners.push({
            color: "red",
            body: <>Pagador sem email — Asaas não envia PIX automático. Adicione email ou use Boleto.</>,
          });
        }

        if (
          summary.comissionados.length === 0 &&
          summary.contract?.status === "aprovado"
        ) {
          banners.push({
            color: "red",
            body: (
              <>
                Sem comissionados no contrato.{" "}
                {onModeChange && (
                  <button
                    type="button"
                    onClick={() => onModeChange("avulsa_in_deal")}
                    className="underline font-medium hover:text-red-700"
                  >
                    Trocar para cobrança avulsa
                  </button>
                )}
              </>
            ),
          });
        }

        return banners.map((b, i) => (
          <div
            key={i}
            className={`border rounded px-3 py-2 text-xs flex items-center gap-2 ${
              b.color === "red"
                ? "bg-red-50 text-red-900 border-red-300"
                : "bg-amber-50 text-amber-900 border-amber-300"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <div>{b.body}</div>
          </div>
        ));
      })()}

      {/* STEP 1: Payer */}
      {step === "payer" && (
        <Card>
          <CardHeader>
            <CardTitle>Quem vai pagar?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Standalone — busca/cria AsaasCustomer */}
            {isAvulsaStandalone && (
              <>
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
              </>
            )}

            {/* Deal-bound — pré-popula de parties + permite editar inline */}
            {!isAvulsaStandalone && summary && (
              <>
                <div>
                  <Label>Parte</Label>
                  <Select
                    value={selectedPartyKey}
                    onValueChange={pickPartyByKey}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a parte que vai pagar" />
                    </SelectTrigger>
                    <SelectContent>
                      {summary.parties.map((p) => (
                        <SelectItem
                          key={`${p.papel}-${p.index}`}
                          value={`${p.papel}-${p.index}`}
                        >
                          {p.papel === "comprador" ? "Comprador" : "Vendedor"}{" "}
                          {p.index + 1}: {p.nome || "(sem nome)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {summary.payerError && (
                    <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {summary.payerError}
                    </p>
                  )}
                  {summary.suggestedPayer && !summary.payerError && (() => {
                    const isOverridden =
                      selectedPartyKey !==
                      `${summary.suggestedPayer.papel}-${summary.suggestedPayer.index}`;
                    if (!isOverridden) return null; // padrão é o sugerido — sem ruído
                    return (
                      <p className="text-xs text-muted-foreground mt-1">
                        Sugestão original: {summary.suggestedPayer.papel} (
                        {summary.suggestedPayer.nome || "—"})
                      </p>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="payer-name">Nome</Label>
                    <Input
                      id="payer-name"
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="payer-cpf">CPF/CNPJ</Label>
                    <Input
                      id="payer-cpf"
                      value={payerCpfCnpj}
                      onChange={(e) => setPayerCpfCnpj(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="payer-email">Email</Label>
                    <Input
                      id="payer-email"
                      type="email"
                      value={payerEmail}
                      onChange={(e) => setPayerEmail(e.target.value)}
                      placeholder="recomendado para notificação"
                    />
                  </div>
                  <div>
                    <Label htmlFor="payer-phone">Celular</Label>
                    <Input
                      id="payer-phone"
                      type="tel"
                      value={payerPhone}
                      onChange={(e) => setPayerPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                </div>
              </>
            )}

            {!isAvulsaStandalone && !summary && !summaryError && (
              <p className="text-sm text-muted-foreground italic">
                Carregando dados do contrato...
              </p>
            )}

            <Button
              onClick={() =>
                setStep("charge")
              }
              disabled={!payerReady}
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
            {/* Conta destino — só aparece quando há +1 conta acessível */}
            {accounts.length > 1 && (
              <div>
                <Label htmlFor="charge-account" className="text-xs">
                  Conta destino
                </Label>
                <Select
                  value={accountId}
                  onValueChange={(v) => setAccountId(v)}
                >
                  <SelectTrigger id="charge-account">
                    <SelectValue placeholder="Selecione a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label ?? `Conta ${a.id.slice(0, 6)}`}
                        {a.isActive ? " · ativa" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  A cobrança ficará vinculada permanentemente a essa conta.
                </p>
              </div>
            )}
            {accounts.length === 1 && (
              <p className="text-xs text-muted-foreground">
                Conta destino:{" "}
                <strong>
                  {accounts[0].label ?? `Conta ${accounts[0].id.slice(0, 6)}`}
                </strong>
              </p>
            )}

            {summary?.suggestedDueDate.reason && mode === "commission_from_deal" && (() => {
              const usandoHojeComoBase =
                /^\d+ dias após (registro|chaves|quitação)/i.test(
                  summary.suggestedDueDate.reason
                );
              return (
                <div className="border rounded p-2 bg-blue-50 text-xs text-blue-900 flex gap-2">
                  <Lightbulb className="h-3 w-3 shrink-0 mt-0.5" />
                  <div>
                    Sugerido: {summary.suggestedDueDate.reason}
                    {usandoHojeComoBase && (
                      <span className="text-amber-800">
                        {" "}
                        (a partir de hoje)
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

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
              <Label htmlFor="cw-val">Valor</Label>
              <Input
                id="cw-val"
                type="number"
                step="0.01"
                min="1"
                placeholder="0,00"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cw-due">Vencimento</Label>
              <Input
                id="cw-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
              {(() => {
                const check = checkBusinessDay(dueDate);
                if (check.isBusinessDay) return null;
                const reasonLabel =
                  check.reason === "saturday"
                    ? "sábado"
                    : check.reason === "sunday"
                      ? "domingo"
                      : `feriado (${check.holidayName})`;
                const adjusted = check.adjustedToISO
                  ? new Date(check.adjustedToISO + "T00:00:00").toLocaleDateString("pt-BR")
                  : "próximo dia útil";
                return (
                  <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      Esta data cai em {reasonLabel}. A Asaas pode ajustar
                      automaticamente para {adjusted}.
                    </span>
                  </p>
                );
              })()}
            </div>

            {isAvulsa && (
              <>
                <div>
                  <Label htmlFor="cw-kind">Tipo</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as "avulsa" | "aluguel" | "outros")}>
                    <SelectTrigger id="cw-kind">
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
                  <Label htmlFor="cw-cat">Categoria / Identificação *</Label>
                  <Input
                    id="cw-cat"
                    list="cw-cat-options"
                    value={categoryLabel}
                    onChange={(e) => setCategoryLabel(e.target.value)}
                    placeholder="Ex: Reembolso de matrícula"
                  />
                  <datalist id="cw-cat-options">
                    {categoryOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </>
            )}

            <div>
              <Label htmlFor="cw-desc">Descrição (opcional)</Label>
              <Input
                id="cw-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  mode === "commission_from_deal"
                    ? `Comissão — ${summary?.deal.title ?? "negócio"}`
                    : "Descrição vista pelo pagador"
                }
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Se vazio em comissão, sistema gera automaticamente nomeando os
                comissionados visíveis (não-ocultos).
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("payer")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={() =>
                  setStep(mode === "commission_from_deal" ? "splits" : "review")
                }
                disabled={!chargeReady}
                className="flex-1"
              >
                Próximo <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Splits (só em commission_from_deal) */}
      {step === "splits" && mode === "commission_from_deal" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Repasse de comissão
              <span
                className="text-xs font-normal text-muted-foreground cursor-help"
                title="Splits pré-preenchidos do contrato. EyeOff oculta linhas do pagador (valor consolida em outra). PIX externos disparam após pagamento."
              >
                (?)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SplitEditor
              value={splits}
              onChange={setSplits}
              platformFeePercent={platformFeePercent}
              chargeValue={parseFloat(value || "0")}
              seedFromComissionados={summary?.comissionados ?? []}
              enableHideFromPayer
            />

            {blockingNoMatch > 0 && (
              <div className="border rounded p-2 bg-amber-50 text-xs text-amber-900 flex gap-2">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <div>
                  {blockingNoMatch} comissionado(s) ainda sem cadastro de
                  destinatário. Use o botão &ldquo;Cadastrar como destinatário&rdquo;
                  acima ou remova a linha antes de prosseguir.
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("charge")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={() => setStep("review")}
                disabled={blockingNoMatch > 0}
                className="flex-1"
              >
                Próximo <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4: Review */}
      {step === "review" && (
        <Card>
          <CardHeader>
            <CardTitle>Revisão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Pagador:</span>{" "}
                {isAvulsaStandalone && selectedCustomer
                  ? `${selectedCustomer.name} (${maskCpfCnpj(selectedCustomer.cpfCnpj)})`
                  : `${payerName} (${maskCpfCnpj(payerCpfCnpj)})`}
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
                {fmtDueDate(dueDate)}
              </div>
              {isAvulsa && (
                <div>
                  <span className="text-muted-foreground">Tipo:</span> {kind} ·{" "}
                  <strong>{categoryLabel}</strong>
                </div>
              )}
            </div>

            {/* Splits visíveis vs ocultos */}
            {mode === "commission_from_deal" && splits.length > 0 && (() => {
              const visibles = splits.filter(
                (s) => s.percentualValue > 0 && !s.hiddenFromPayer
              );
              const hiddens = splits.filter(
                (s) => s.percentualValue > 0 && s.hiddenFromPayer
              );
              return (
                <div className="border-t pt-3 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground uppercase">
                    Splits visíveis para o pagador
                  </div>
                  {visibles.length === 0 ? (
                    <p className="text-xs text-amber-700 italic">
                      Nenhum visível — descrição vai usar fallback.
                    </p>
                  ) : (
                    visibles.map((s) => {
                      const consolidated = hiddens
                        .filter((h) => h.consolidateInto === s.key)
                        .reduce((acc, h) => acc + h.percentualValue, 0);
                      const totalPct = s.percentualValue + consolidated;
                      return (
                        <div
                          key={s.key}
                          className="flex items-center justify-between text-sm"
                        >
                          <span>
                            {s.recipientType === "pix_external" ? "🔑 " : "💼 "}
                            {s.label || s.ownerName || s.walletId || s.pixAddressKey}
                            {consolidated > 0 && (
                              <span className="text-xs text-gray-500 ml-1">
                                (+{consolidated}% consolidado)
                              </span>
                            )}
                          </span>
                          <Badge variant="outline">
                            {totalPct}% · {fmtBRL((parseFloat(value || "0") * totalPct) / 100)}
                          </Badge>
                        </div>
                      );
                    })
                  )}

                  {hiddens.length > 0 && (
                    <>
                      <div className="text-xs font-medium text-muted-foreground uppercase mt-3 flex items-center gap-1">
                        <EyeOff className="h-3 w-3" /> Ocultos do pagador
                      </div>
                      {hiddens.map((s) => (
                        <div
                          key={s.key}
                          className="flex items-center justify-between text-sm text-gray-600"
                        >
                          <span>
                            {s.recipientType === "pix_external" ? "🔑 " : "💼 "}
                            {s.label || s.ownerName}
                          </span>
                          <Badge variant="outline">
                            {s.percentualValue}%
                          </Badge>
                        </div>
                      ))}
                      <p className="text-xs text-gray-500 italic mt-1">
                        O pagador não vê esses nomes — o valor é somado ao split
                        visível adjacente na exibição interna e na descrição.
                      </p>
                    </>
                  )}

                  {platformFeePercent > 0 && (
                    <div className="flex items-center justify-between text-sm text-amber-900 mt-2">
                      <span>Plataforma (automático)</span>
                      <Badge variant="outline">
                        {platformFeePercent}% ·{" "}
                        {fmtBRL((parseFloat(value || "0") * platformFeePercent) / 100)}
                      </Badge>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setStep(mode === "commission_from_deal" ? "splits" : "charge")
                }
              >
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

      {/* Link de fallback pra cadastrar destinatários */}
      {step === "splits" && (
        <p className="text-xs text-muted-foreground text-center">
          Gerencie destinatários cadastrados em{" "}
          <Link
            href="/settings/pagamentos/split-recipients"
            className="underline"
            target="_blank"
          >
            Configurações → Destinatários de split
          </Link>
        </p>
      )}
    </div>
  );
}
