"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowLeft, Plus, Send, Trash2, Wallet } from "lucide-react";
import { CLICKSIGN_ROLE_OPTIONS, type ClicksignRole } from "@/lib/clicksign/roles";

interface Representante {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
}

interface LeaseParte {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
  representante?: Representante;
}

export interface LeaseSignerData {
  locadores: LeaseParte[];
  locatarios: LeaseParte[];
  garantia?: { tipo?: string; fiador?: LeaseParte } | null;
}

interface SendLeaseEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractStatus: string;
  data: LeaseSignerData;
  onSent: () => void;
}

type RowKind = "locador" | "locatario" | "fiador" | "testemunha" | "avulso";
type SubKind = "titular" | "representante" | "avulso";

const ROLE_OPTIONS = CLICKSIGN_ROLE_OPTIONS;
const COST_PER_SIGNER_CENTS = 150;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KIND_LABELS: Record<RowKind, string> = {
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
  testemunha: "Testemunha",
  avulso: "Avulso",
};

function defaultRoleFor(sourceKind: RowKind): ClicksignRole {
  switch (sourceKind) {
    case "fiador":
      return "consenting";
    case "testemunha":
      return "witness";
    case "locador":
    case "locatario":
      return "party";
    default:
      return "sign";
  }
}

interface EditableRow {
  rowId: string;
  sourceKind: RowKind;
  sourceIndex: number;
  subKind: SubKind;
  name: string;
  email: string;
  documentation: string;
  phone: string;
  isPJ?: boolean;
  addedDuringDialog: boolean;
  clicksignRole: ClicksignRole;
}

function partyName(p: LeaseParte): string {
  return (p.nome || p.razao_social || "").trim();
}

function onlyDigits(s: string | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function maskCpfCnpj(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function buildPartyRow(
  sourceKind: RowKind,
  p: LeaseParte,
  idx: number
): EditableRow {
  const isPJ = p.tipo_pessoa === "juridica";
  if (isPJ) {
    const rep = p.representante ?? {};
    return {
      rowId: `${sourceKind}-${idx}-rep`,
      sourceKind,
      sourceIndex: idx,
      subKind: "representante",
      name: (rep.nome || "").trim() || partyName(p),
      email: (rep.email ?? "").trim(),
      documentation: onlyDigits(rep.cpf),
      phone: onlyDigits(rep.mobile_phone),
      isPJ: true,
      addedDuringDialog: false,
      clicksignRole: defaultRoleFor(sourceKind),
    };
  }
  return {
    rowId: `${sourceKind}-${idx}`,
    sourceKind,
    sourceIndex: idx,
    subKind: "titular",
    name: partyName(p),
    email: (p.email ?? "").trim(),
    documentation: onlyDigits(p.cpf),
    phone: onlyDigits(p.mobile_phone),
    addedDuringDialog: false,
    clicksignRole: defaultRoleFor(sourceKind),
  };
}

function buildInitialRows(data: LeaseSignerData): EditableRow[] {
  const rows: EditableRow[] = [];
  (data.locadores ?? []).forEach((p, i) =>
    rows.push(buildPartyRow("locador", p, i))
  );
  (data.locatarios ?? []).forEach((p, i) =>
    rows.push(buildPartyRow("locatario", p, i))
  );
  if (data.garantia?.tipo === "fiador" && data.garantia.fiador) {
    rows.push(buildPartyRow("fiador", data.garantia.fiador, 0));
  }
  return rows;
}

interface DefaultWitness {
  id: string;
  nome: string;
  cpf: string | null;
  email: string;
  mobilePhone: string | null;
}

export function SendLeaseEnvelopeDialog({
  open,
  onOpenChange,
  contractId,
  contractStatus,
  data,
  onSent,
}: SendLeaseEnvelopeDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [orderEnabled, setOrderEnabled] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [rows, setRows] = useState<EditableRow[]>([]);

  useEffect(() => {
    if (!open) return;
    setRows(buildInitialRows(data));
    setSubmitting(false);
    setOrderEnabled(false);
    setStep("edit");

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/witnesses?default=1");
        if (!res.ok) return;
        const body = await res.json().catch(() => ({}));
        const witnesses: DefaultWitness[] = body.witnesses ?? [];
        if (cancelled || witnesses.length === 0) return;
        setRows((prev) => {
          const start = prev.filter((r) => r.sourceKind === "testemunha").length;
          let nextIdx = start;
          return [
            ...prev,
            ...witnesses.map((w) => ({
              rowId: `testemunha-default-${w.id}`,
              sourceKind: "testemunha" as RowKind,
              sourceIndex: nextIdx++,
              subKind: "titular" as SubKind,
              name: w.nome,
              email: w.email,
              documentation: onlyDigits(w.cpf ?? ""),
              phone: onlyDigits(w.mobilePhone ?? ""),
              addedDuringDialog: false,
              clicksignRole: defaultRoleFor("testemunha"),
            })),
          ];
        });
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, data]);

  const validationError = useMemo(() => {
    if (rows.length === 0) return "Inclua ao menos 1 signatário";
    for (const r of rows) {
      if (r.name.trim().length < 2) return `Nome ausente em ${labelFor(r)}`;
      if (!EMAIL_REGEX.test(r.email.trim()))
        return `E-mail inválido em ${labelFor(r)}`;
      const d = r.documentation.replace(/\D/g, "");
      if (d && d.length !== 11 && d.length !== 14)
        return `CPF/CNPJ inválido em ${labelFor(r)}`;
    }
    return null;
  }, [rows]);

  const costCents = rows.length * COST_PER_SIGNER_CENTS;
  const showApprovedWarning =
    contractStatus === "aprovado" && rows.some((r) => r.addedDuringDialog);

  const updateRow = (rowId: string, patch: Partial<EditableRow>) =>
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  const removeRow = (rowId: string) =>
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  const addAvulso = () =>
    setRows((prev) => [
      ...prev,
      {
        rowId: `avulso-${prev.length}-${Math.random().toString(36).slice(2, 8)}`,
        sourceKind: "avulso",
        sourceIndex: prev.filter((r) => r.sourceKind === "avulso").length,
        subKind: "avulso",
        name: "",
        email: "",
        documentation: "",
        phone: "",
        addedDuringDialog: true,
        clicksignRole: "sign",
      },
    ]);

  const handleContinue = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setStep("review");
  };

  const handleSend = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const signers = rows.map((r, idx) => ({
        name: r.name.trim(),
        email: r.email.trim(),
        documentation: r.documentation.replace(/\D/g, "") || null,
        phone: r.phone.replace(/\D/g, "") || null,
        sourceKind: r.sourceKind,
        sourceIndex: r.sourceIndex,
        subKind: r.subKind,
        role: r.clicksignRole,
        group: orderEnabled ? idx + 1 : null,
      }));
      const res = await fetch(`/api/contracts/${contractId}/envelopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authMethod: "email", signers }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(body.missing)) {
          toast.error(`Faltam e-mails em ${body.missing.length} parte(s).`);
          setStep("edit");
          return;
        }
        if (res.status === 402) {
          toast.error(
            `Orçamento mensal excedido (R$ ${(body.spentCents / 100).toFixed(2)} de R$ ${(body.budgetCents / 100).toFixed(2)}).`
          );
          return;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      toast.success("Envelope enviado para assinatura");
      onSent();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "edit" ? "Enviar para assinatura" : "Revisar e enviar"}
          </DialogTitle>
          <DialogDescription>
            {step === "edit"
              ? "Confira os signatários, dados e o papel de cada um. Autenticação por token de e-mail."
              : "Confira a lista final de signatários antes de enviar o envelope ClickSign."}
          </DialogDescription>
        </DialogHeader>

        {step === "edit" ? (
          <div className="space-y-4 py-1">
            {rows.map((row) => (
              <SignerCard
                key={row.rowId}
                row={row}
                onChange={updateRow}
                onRemove={removeRow}
              />
            ))}

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addAvulso}
              className="w-full border-dashed"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Adicionar assinante avulso
            </Button>

            <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border bg-muted/30 px-3 py-2">
              <input
                type="checkbox"
                checked={orderEnabled}
                onChange={(e) => setOrderEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className="font-medium">Assinar em ordem</span>
              <span className="text-xs text-muted-foreground">
                Cada signatário só é notificado depois que o anterior assina.
              </span>
            </label>

            {showApprovedWarning && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Assinantes adicionados após a aprovação entram no certificado da
                  ClickSign, mas não no corpo do PDF já congelado.
                </span>
              </div>
            )}

            {validationError && rows.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Wallet className="h-4 w-4" /> Custo estimado ({rows.length}{" "}
                signatário{rows.length === 1 ? "" : "s"})
              </span>
              <span className="text-sm font-medium">
                R$ {(costCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <ReviewStep rows={rows} orderEnabled={orderEnabled} costCents={costCents} />
        )}

        <DialogFooter>
          {step === "edit" ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button onClick={handleContinue} disabled={validationError !== null}>
                Revisar signatários
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("edit")}
                disabled={submitting}
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Voltar
              </Button>
              <Button onClick={handleSend} disabled={submitting}>
                <Send className="h-4 w-4 mr-2" />
                {submitting ? "Enviando..." : "Enviar envelope"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignerCard({
  row,
  onChange,
  onRemove,
}: {
  row: EditableRow;
  onChange: (rowId: string, patch: Partial<EditableRow>) => void;
  onRemove: (rowId: string) => void;
}) {
  const docLabel = row.isPJ === true && row.subKind !== "representante" ? "CNPJ" : "CPF";
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="shrink-0 text-[11px]">
            {KIND_LABELS[row.sourceKind] ?? row.sourceKind}
          </Badge>
          <span className="text-sm font-medium text-foreground truncate">
            {labelFor(row)}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive hover:text-destructive shrink-0"
          onClick={() => onRemove(row.rowId)}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Remover
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">Nome completo</Label>
          <Input
            value={row.name}
            onChange={(e) => onChange(row.rowId, { name: e.target.value })}
            placeholder="Nome completo"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">E-mail</Label>
          <Input
            type="email"
            value={row.email}
            onChange={(e) => onChange(row.rowId, { email: e.target.value })}
            placeholder="email@exemplo.com"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Celular</Label>
          <Input
            value={maskPhone(row.phone)}
            onChange={(e) =>
              onChange(row.rowId, { phone: e.target.value.replace(/\D/g, "") })
            }
            placeholder="(11) 90000-0000"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{docLabel}</Label>
          <Input
            value={maskCpfCnpj(row.documentation)}
            onChange={(e) =>
              onChange(row.rowId, {
                documentation: e.target.value.replace(/\D/g, ""),
              })
            }
            placeholder={docLabel === "CNPJ" ? "00.000.000/0000-00" : "000.000.000-00"}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Assina como</Label>
          <select
            value={row.clicksignRole}
            onChange={(e) =>
              onChange(row.rowId, { clicksignRole: e.target.value as ClicksignRole })
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function ReviewStep({
  rows,
  orderEnabled,
  costCents,
}: {
  rows: EditableRow[];
  orderEnabled: boolean;
  costCents: number;
}) {
  const roleLabel = (role: ClicksignRole) =>
    ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
  return (
    <div className="space-y-3 py-1">
      <div className="rounded-lg border divide-y">
        {rows.map((r, idx) => (
          <div key={r.rowId} className="flex items-start gap-3 px-4 py-3">
            {orderEnabled && (
              <span className="text-xs text-muted-foreground mt-0.5 w-5 shrink-0">
                {idx + 1}º
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{r.name}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {roleLabel(r.clicksignRole)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {r.email}
                {r.phone ? ` · ${maskPhone(r.phone)}` : ""}
                {r.documentation ? ` · ${maskCpfCnpj(r.documentation)}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Wallet className="h-4 w-4" /> Custo estimado ({rows.length} signatário
          {rows.length === 1 ? "" : "s"})
        </span>
        <span className="text-sm font-medium">
          R$ {(costCents / 100).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function labelFor(row: EditableRow): string {
  if (row.name.trim()) {
    if (row.subKind === "representante") return `${row.name.trim()} (representante)`;
    return row.name.trim();
  }
  if (row.subKind === "representante") return "Representante";
  return `${KIND_LABELS[row.sourceKind] ?? row.sourceKind} ${row.sourceIndex + 1}`;
}
