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
import {
  AlertTriangle,
  ArrowLeft,
  Plus,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import { CLICKSIGN_ROLE_OPTIONS, type ClicksignRole } from "@/lib/clicksign/roles";

interface Conjuge {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
  incluir_como_signatario?: boolean;
}

interface Procurador {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
  incluir_como_signatario?: boolean;
}

interface Representante {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
}

interface Parte {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
  conjuge?: Conjuge;
  procurador?: Procurador;
  representante?: Representante;
}

interface Testemunha {
  nome?: string;
  cpf?: string;
  email?: string;
  incluir_como_signatario?: boolean;
}

interface Comissionado {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: string;
  email?: string;
  mobile_phone?: string;
  percentual?: number;
  valor?: number;
  incluir_como_signatario?: boolean;
}

interface Corretora {
  corretora_tipo_pessoa?: string;
  imobiliaria_nome?: string;
  imobiliaria_cnpj?: string;
  imobiliaria_email?: string;
  creci?: string;
  incluir_como_signatario?: boolean;
  comissionados?: Comissionado[];
}

interface SendEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractTitle: string;
  contractStatus: string;
  vendedores: Parte[];
  compradores: Parte[];
  testemunhas: Testemunha[];
  comissao: Corretora | null | undefined;
  onSent: () => void;
}

type RowKind = "vendedor" | "comprador" | "corretora" | "testemunha" | "avulso";
type SubKind = "titular" | "conjuge" | "procurador" | "representante" | "avulso";

const ROLE_OPTIONS = CLICKSIGN_ROLE_OPTIONS;
const COST_PER_SIGNER_CENTS = 150;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function defaultRoleFor(sourceKind: RowKind, subKind: SubKind): ClicksignRole {
  if (subKind === "conjuge") return "consenting";
  if (subKind === "procurador") return "attorney";
  switch (sourceKind) {
    case "vendedor":
      return "seller";
    case "comprador":
      return "buyer";
    case "corretora":
      return "intervening";
    case "testemunha":
      return "witness";
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
  /** Para corretora/representante: PJ afeta máscara do documento. */
  isPJ?: boolean;
  /** Adicionado na popup (não veio do form) — usado no banner de aprovado. */
  addedDuringDialog: boolean;
  clicksignRole: ClicksignRole;
}

function partyName(p: Parte): string {
  return (p.nome || p.razao_social || "").trim();
}

function onlyDigits(s: string | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function maskCpfCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

/**
 * Monta as linhas iniciais a partir das partes do form. TODAS entram como
 * signatárias por padrão (vendedor/comprador titular, cônjuge, procurador,
 * representante de PJ) + corretora(s) como intermediador. Testemunhas padrão
 * do sistema são injetadas separadamente via fetch (não entram aqui).
 */
function buildInitialRows(
  vendedores: Parte[],
  compradores: Parte[],
  testemunhas: Testemunha[],
  comissao: Corretora | null | undefined
): EditableRow[] {
  const rows: EditableRow[] = [];

  const pushPartyRows = (sourceKind: "vendedor" | "comprador", partes: Parte[]) => {
    partes.forEach((p, idx) => {
      const isPJ = p.tipo_pessoa === "juridica";
      if (isPJ) {
        // PJ assina pelo representante legal (PF com CPF).
        const rep = p.representante ?? {};
        rows.push({
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
          clicksignRole: defaultRoleFor(sourceKind, "representante"),
        });
        return;
      }
      // PF titular.
      rows.push({
        rowId: `${sourceKind}-${idx}`,
        sourceKind,
        sourceIndex: idx,
        subKind: "titular",
        name: partyName(p),
        email: (p.email ?? "").trim(),
        documentation: onlyDigits(p.cpf),
        phone: onlyDigits(p.mobile_phone),
        addedDuringDialog: false,
        clicksignRole: defaultRoleFor(sourceKind, "titular"),
      });
      // Cônjuge — só quando o form trouxe nome.
      const conjugeName = (p.conjuge?.nome ?? "").trim();
      if (conjugeName) {
        rows.push({
          rowId: `${sourceKind}-${idx}-conjuge`,
          sourceKind,
          sourceIndex: idx,
          subKind: "conjuge",
          name: conjugeName,
          email: (p.conjuge?.email ?? "").trim(),
          documentation: onlyDigits(p.conjuge?.cpf),
          phone: onlyDigits(p.conjuge?.mobile_phone),
          addedDuringDialog: false,
          clicksignRole: defaultRoleFor(sourceKind, "conjuge"),
        });
      }
      // Procurador — só quando o form trouxe nome.
      const procName = (p.procurador?.nome ?? "").trim();
      if (procName) {
        rows.push({
          rowId: `${sourceKind}-${idx}-procurador`,
          sourceKind,
          sourceIndex: idx,
          subKind: "procurador",
          name: procName,
          email: (p.procurador?.email ?? "").trim(),
          documentation: onlyDigits(p.procurador?.cpf),
          phone: onlyDigits(p.procurador?.mobile_phone),
          addedDuringDialog: false,
          clicksignRole: defaultRoleFor(sourceKind, "procurador"),
        });
      }
    });
  };
  pushPartyRows("vendedor", vendedores);
  pushPartyRows("comprador", compradores);

  // Corretora(s): canônico `comissionados[]`, fallback legado `imobiliaria_*`.
  // Entram pré-marcados como intermediador.
  const comissionados = comissao?.comissionados ?? [];
  if (comissionados.length > 0) {
    comissionados.forEach((c, idx) => {
      const isPJ =
        c.tipo_pessoa === "juridica" ||
        (onlyDigits(c.cnpj).length === 14 && !onlyDigits(c.cpf).length);
      rows.push({
        rowId: `corretora-${idx}`,
        sourceKind: "corretora",
        sourceIndex: idx,
        subKind: "titular",
        name: (c.nome ?? "").trim(),
        email: (c.email ?? "").trim(),
        documentation: isPJ ? onlyDigits(c.cnpj) : onlyDigits(c.cpf),
        phone: onlyDigits(c.mobile_phone),
        isPJ,
        addedDuringDialog: false,
        clicksignRole: defaultRoleFor("corretora", "titular"),
      });
    });
  } else if ((comissao?.imobiliaria_nome ?? "").trim()) {
    const isPJ = comissao?.corretora_tipo_pessoa !== "fisica";
    rows.push({
      rowId: "corretora-0",
      sourceKind: "corretora",
      sourceIndex: 0,
      subKind: "titular",
      name: (comissao?.imobiliaria_nome ?? "").trim(),
      email: (comissao?.imobiliaria_email ?? "").trim(),
      documentation: onlyDigits(comissao?.imobiliaria_cnpj),
      phone: "",
      isPJ,
      addedDuringDialog: false,
      clicksignRole: defaultRoleFor("corretora", "titular"),
    });
  }

  // Testemunhas NOMEADAS do form (ignora linhas em branco). As testemunhas
  // padrão do sistema são anexadas depois via fetch (deduplicadas).
  testemunhas.forEach((t, idx) => {
    const name = (t.nome ?? "").trim();
    if (!name) return;
    rows.push({
      rowId: `testemunha-form-${idx}`,
      sourceKind: "testemunha",
      sourceIndex: idx,
      subKind: "titular",
      name,
      email: (t.email ?? "").trim(),
      documentation: onlyDigits(t.cpf),
      phone: "",
      addedDuringDialog: false,
      clicksignRole: defaultRoleFor("testemunha", "titular"),
    });
  });

  return rows;
}

interface DefaultWitness {
  id: string;
  nome: string;
  cpf: string | null;
  email: string;
  mobilePhone: string | null;
}

const AUTH_METHOD_LABELS: Record<string, string> = {
  email: "E-mail (token)",
  whatsapp: "WhatsApp",
  selfie: "Selfie + documento",
  icp_brasil: "ICP-Brasil (certificado)",
};

interface SignatureConfig {
  configured: boolean;
  defaultAuthMethod: string;
  allowedAuthMethods: string[];
}

export function SendEnvelopeDialog({
  open,
  onOpenChange,
  contractId,
  contractTitle,
  contractStatus,
  vendedores,
  compradores,
  testemunhas,
  comissao,
  onSent,
}: SendEnvelopeDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [orderEnabled, setOrderEnabled] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [sigConfig, setSigConfig] = useState<SignatureConfig | null>(null);
  const [authMethod, setAuthMethod] = useState("email");

  // Reset + carrega partes e testemunhas padrão quando o dialog abre.
  useEffect(() => {
    if (!open) return;
    const base = buildInitialRows(vendedores, compradores, testemunhas, comissao);
    setRows(base);
    setSubmitting(false);
    setOrderEnabled(false);
    setStep("edit");

    // Config de assinatura da org (métodos permitidos + se está configurada).
    fetch("/api/signatures/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: SignatureConfig | null) => {
        if (cfg) {
          setSigConfig(cfg);
          setAuthMethod(cfg.defaultAuthMethod || "email");
        }
      })
      .catch(() => {});

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/witnesses?default=1");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const witnesses: DefaultWitness[] = data.witnesses ?? [];
        if (cancelled || witnesses.length === 0) return;
        // Anexa as testemunhas padrão SEM duplicar as que já vieram do form
        // (match por e-mail ou CPF) e com sourceIndex contíguo entre testemunhas.
        setRows((prev) => {
          const witnessRows = prev.filter((r) => r.sourceKind === "testemunha");
          const seen = new Set(
            witnessRows.flatMap((r) =>
              [r.email.toLowerCase(), r.documentation].filter(Boolean)
            )
          );
          let nextIdx = witnessRows.length;
          const fresh = witnesses
            .filter((w) => {
              const email = (w.email ?? "").toLowerCase();
              const cpf = onlyDigits(w.cpf ?? "");
              if (email && seen.has(email)) return false;
              if (cpf && seen.has(cpf)) return false;
              return true;
            })
            .map((w) => ({
              rowId: `testemunha-default-${w.id}`,
              sourceKind: "testemunha" as RowKind,
              sourceIndex: nextIdx++,
              subKind: "titular" as SubKind,
              name: w.nome,
              email: w.email,
              documentation: onlyDigits(w.cpf ?? ""),
              phone: onlyDigits(w.mobilePhone ?? ""),
              addedDuringDialog: false,
              clicksignRole: defaultRoleFor("testemunha", "titular"),
            }));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      } catch {
        /* testemunhas padrão são best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Só re-inicializa quando o dialog ABRE (lê os props mais recentes nesse
    // momento). Depender dos arrays de partes resetaria as edições do operador
    // se o pai re-renderizasse (ex.: polling/refresh) com a popup aberta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validationError = useMemo(() => {
    if (rows.length === 0) return "Inclua ao menos 1 signatário";
    for (const r of rows) {
      if (r.name.trim().length < 2) return `Nome ausente em ${labelFor(r)}`;
      if (!EMAIL_REGEX.test(r.email.trim()))
        return `E-mail inválido em ${labelFor(r)}`;
      const docDigits = r.documentation.replace(/\D/g, "");
      if (docDigits && docDigits.length !== 11 && docDigits.length !== 14)
        return `CPF/CNPJ inválido em ${labelFor(r)}`;
    }
    return null;
  }, [rows]);

  const costCents = rows.length * COST_PER_SIGNER_CENTS;
  const showApprovedWarning =
    contractStatus === "aprovado" && rows.some((r) => r.addedDuringDialog);

  const updateRow = (rowId: string, patch: Partial<EditableRow>) => {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const addAvulso = () => {
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
  };

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
      // 1) Persiste edições das partes no deal/form/contract (Dados + re-uso).
      const updates = buildPatchUpdates(rows, vendedores, compradores);
      if (updates.length > 0) {
        const patchRes = await fetch(
          `/api/contracts/${contractId}/signers-data`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates }),
          }
        );
        if (!patchRes.ok) {
          const body = await patchRes.json().catch(() => ({}));
          throw new Error(
            body.error || `Falha ao salvar dados (HTTP ${patchRes.status})`
          );
        }
      }

      // 2) Envia o envelope com a lista EXPLÍCITA de signatários (autoritativa).
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
        body: JSON.stringify({ authMethod, signers }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && body.code === "CLICKSIGN_NOT_CONFIGURED") {
          toast.error(
            "Conecte a conta ClickSign da imobiliária em Configurações › Assinaturas para enviar."
          );
          return;
        }
        if (res.status === 422 && Array.isArray(body.missing)) {
          toast.error(
            `Faltam e-mails em ${body.missing.length} parte(s). Verifique a lista.`
          );
          setStep("edit");
          return;
        }
        if (res.status === 402) {
          toast.error(
            `Orçamento mensal excedido. Gasto: R$ ${(body.spentCents / 100).toFixed(2)} de R$ ${(body.budgetCents / 100).toFixed(2)}.`
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
              ? `${contractTitle} — confira os signatários, dados e o papel de cada um.`
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

            {sigConfig && !sigConfig.configured && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  A conta ClickSign da imobiliária ainda não está conectada.{" "}
                  <a
                    href="/settings/signatures?tab=conexao"
                    className="font-medium underline"
                  >
                    Conectar agora
                  </a>{" "}
                  para poder enviar.
                </span>
              </div>
            )}

            {/* Tipo de assinatura */}
            {sigConfig && sigConfig.allowedAuthMethods.length > 1 && (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <span className="text-sm font-medium">Tipo de assinatura</span>
                <select
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value)}
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                >
                  {sigConfig.allowedAuthMethods.map((m) => (
                    <option key={m} value={m}>
                      {AUTH_METHOD_LABELS[m] ?? m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Ordem de assinatura */}
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
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-amber-900 mb-1">
                  <AlertTriangle className="h-4 w-4" />
                  Assinante adicionado após aprovação
                </div>
                <p className="text-amber-900">
                  Assinantes adicionados aqui entram no certificado da ClickSign,
                  mas não aparecem no corpo do PDF do contrato (já congelado pela
                  aprovação).
                </p>
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
              <Button
                onClick={handleContinue}
                disabled={
                  validationError !== null ||
                  (sigConfig !== null && !sigConfig.configured)
                }
              >
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
  const docLabel =
    row.isPJ === true && row.subKind !== "representante" ? "CNPJ" : "CPF";

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="shrink-0 text-[11px]">
            {kindLabel(row)}
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
              onChange(row.rowId, {
                clicksignRole: e.target.value as ClicksignRole,
              })
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

const KIND_LABELS: Record<RowKind, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  corretora: "Corretor",
  testemunha: "Testemunha",
  avulso: "Avulso",
};

function kindLabel(row: EditableRow): string {
  return KIND_LABELS[row.sourceKind] ?? row.sourceKind;
}

function labelFor(row: EditableRow): string {
  if (row.name.trim()) {
    if (row.subKind === "conjuge") return `${row.name.trim()} (cônjuge)`;
    if (row.subKind === "procurador") return `${row.name.trim()} (procurador)`;
    if (row.subKind === "representante") return `${row.name.trim()} (representante)`;
    return row.name.trim();
  }
  const base = kindLabel(row);
  if (row.subKind === "conjuge") return "Cônjuge";
  if (row.subKind === "procurador") return "Procurador";
  if (row.subKind === "representante") return "Representante";
  return `${base} ${row.sourceIndex + 1}`;
}

/**
 * Constrói os updates dot-path pra sincronizar `dataJson` (deal/form/contract)
 * com o que foi editado na popup. Persiste APENAS dados das partes derivadas do
 * form (titular/cônjuge/procurador/representante + comissionados). Testemunhas
 * padrão e avulsos NÃO são gravados no deal — só vão na lista de signatários do
 * envelope (explícita no POST). O envio é autoritativo pela lista, então não
 * mexemos em flags de inclusão de partes removidas aqui.
 */
function buildPatchUpdates(
  rows: EditableRow[],
  vendedores: Parte[],
  compradores: Parte[]
): Array<{ path: string; value: unknown }> {
  const updates: Array<{ path: string; value: unknown }> = [];

  for (const r of rows) {
    if (r.sourceKind !== "vendedor" && r.sourceKind !== "comprador") continue;
    const arr = r.sourceKind === "vendedor" ? "vendedores" : "compradores";
    const i = r.sourceIndex;
    const docDigits = r.documentation.replace(/\D/g, "");
    const phoneDigits = r.phone.replace(/\D/g, "");

    if (r.subKind === "conjuge") {
      updates.push({ path: `${arr}.${i}.conjuge.nome`, value: r.name.trim() });
      updates.push({ path: `${arr}.${i}.conjuge.email`, value: r.email.trim() });
      if (docDigits) updates.push({ path: `${arr}.${i}.conjuge.cpf`, value: docDigits });
      if (phoneDigits)
        updates.push({ path: `${arr}.${i}.conjuge.mobile_phone`, value: phoneDigits });
      updates.push({
        path: `${arr}.${i}.conjuge.incluir_como_signatario`,
        value: true,
      });
      continue;
    }
    if (r.subKind === "procurador") {
      updates.push({ path: `${arr}.${i}.procurador.nome`, value: r.name.trim() });
      updates.push({ path: `${arr}.${i}.procurador.email`, value: r.email.trim() });
      if (docDigits)
        updates.push({ path: `${arr}.${i}.procurador.cpf`, value: docDigits });
      if (phoneDigits)
        updates.push({ path: `${arr}.${i}.procurador.mobile_phone`, value: phoneDigits });
      updates.push({
        path: `${arr}.${i}.procurador.incluir_como_signatario`,
        value: true,
      });
      continue;
    }
    if (r.subKind === "representante") {
      updates.push({ path: `${arr}.${i}.representante.nome`, value: r.name.trim() });
      updates.push({ path: `${arr}.${i}.representante.email`, value: r.email.trim() });
      if (docDigits)
        updates.push({ path: `${arr}.${i}.representante.cpf`, value: docDigits });
      if (phoneDigits)
        updates.push({
          path: `${arr}.${i}.representante.mobile_phone`,
          value: phoneDigits,
        });
      continue;
    }
    // Titular PF.
    updates.push({ path: `${arr}.${i}.email`, value: r.email.trim() });
    if (phoneDigits)
      updates.push({ path: `${arr}.${i}.mobile_phone`, value: phoneDigits });
    updates.push({ path: `${arr}.${i}.nome`, value: r.name.trim() });
    if (docDigits) updates.push({ path: `${arr}.${i}.cpf`, value: docDigits });
  }

  // Corretora: substitui o array `comissao.comissionados` inteiro (cobre edição
  // de nome/email/celular/doc). Não toca nos campos legados `imobiliaria_*`.
  const corretoraRows = rows
    .filter((r) => r.sourceKind === "corretora")
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
  if (corretoraRows.length > 0) {
    updates.push({
      path: "comissao.comissionados",
      value: corretoraRows.map((r) => {
        const docDigits = r.documentation.replace(/\D/g, "");
        const isPJ = r.isPJ === true || (r.isPJ !== false && docDigits.length === 14);
        return {
          nome: r.name.trim(),
          cpf: isPJ ? "" : docDigits,
          cnpj: isPJ ? docDigits : "",
          tipo_pessoa: isPJ ? "juridica" : "fisica",
          email: r.email.trim(),
          mobile_phone: r.phone.replace(/\D/g, ""),
          incluir_como_signatario: true,
        };
      }),
    });
  }

  // Cônjuge/procurador que existiam no form mas foram REMOVIDOS da popup:
  // desmarca incluir_como_signatario pra não reaparecerem auto-marcados no
  // próximo envelope (espelha a intenção do operador no dataJson).
  const hasRow = (sourceKind: RowKind, idx: number, subKind: SubKind) =>
    rows.some(
      (r) => r.sourceKind === sourceKind && r.sourceIndex === idx && r.subKind === subKind
    );
  const unsetRemoved = (sourceKind: "vendedor" | "comprador", partes: Parte[]) => {
    const arr = sourceKind === "vendedor" ? "vendedores" : "compradores";
    partes.forEach((p, idx) => {
      if ((p.conjuge?.nome ?? "").trim() && !hasRow(sourceKind, idx, "conjuge")) {
        updates.push({
          path: `${arr}.${idx}.conjuge.incluir_como_signatario`,
          value: false,
        });
      }
      if ((p.procurador?.nome ?? "").trim() && !hasRow(sourceKind, idx, "procurador")) {
        updates.push({
          path: `${arr}.${idx}.procurador.incluir_como_signatario`,
          value: false,
        });
      }
    });
  };
  unsetRemoved("vendedor", vendedores);
  unsetRemoved("comprador", compradores);

  return updates;
}
