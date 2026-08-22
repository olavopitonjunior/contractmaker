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
  ClipboardCheck,
  Plus,
  Send,
  Trash2,
  UsersRound,
} from "lucide-react";
import {
  CLICKSIGN_ROLE_OPTIONS,
  defaultRoleForSourceKind,
  type ClicksignRole,
} from "@/lib/clicksign/roles";
import { WitnessPicker, pickNewWitnesses, type RegistryWitness } from "@/components/pipeline/WitnessPicker";
import { isExplicitlyUnmarried } from "@/lib/forms/estado-civil";

interface Representante {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
}

interface Conjuge {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
  incluir_como_signatario?: boolean;
}

interface LeaseParte {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
  estado_civil?: string;
  representante?: Representante;
  conjuge?: Conjuge;
}

export interface LeaseSignerData {
  locadores: LeaseParte[];
  locatarios: LeaseParte[];
  garantia?: { tipo?: string; fiador?: LeaseParte } | null;
}

/** Instrumento sendo enviado: locação (default) ou contrato de administração
 *  (imobiliária ↔ proprietário — signers = locadores + representante da org). */
export type LeaseEnvelopeVariant = "locacao" | "administracao";

interface SendLeaseEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractStatus: string;
  data: LeaseSignerData;
  onSent: () => void;
  variant?: LeaseEnvelopeVariant;
  /** Nome da org pra pré-preencher a linha da imobiliária (variant administracao). */
  imobiliaria?: { nome?: string };
  /** LeaseContract do deal. Habilita anexar o laudo de vistoria no MESMO
   *  envelope (mesma cobrança por signatário). Ausente = seção não aparece. */
  leaseContractId?: string;
}

/** Vistoria com laudo pronto, candidata a entrar no envelope do contrato. */
interface InspectionOption {
  id: string;
  tipo: string;
  status: string;
  laudoPdfUrl: string | null;
}

type RowKind =
  | "locador"
  | "locatario"
  | "fiador"
  | "testemunha"
  | "avulso"
  | "imobiliaria";
type SubKind = "titular" | "conjuge" | "representante" | "avulso";

const ROLE_OPTIONS = CLICKSIGN_ROLE_OPTIONS;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KIND_LABELS: Record<RowKind, string> = {
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
  testemunha: "Testemunha",
  avulso: "Avulso",
  imobiliaria: "Imobiliária",
};

// Na administração o locador assina como PROPRIETÁRIO (mesmo dado, papel
// contextual diferente).
const KIND_LABELS_ADMINISTRACAO: Record<RowKind, string> = {
  ...KIND_LABELS,
  locador: "Proprietário",
};

function kindLabel(sourceKind: RowKind, variant: LeaseEnvelopeVariant): string {
  const map = variant === "administracao" ? KIND_LABELS_ADMINISTRACAO : KIND_LABELS;
  return map[sourceKind] ?? sourceKind;
}

/** Papel default — fonte única em lib/clicksign/roles.ts (server usa a mesma). */
const defaultRoleFor = (sourceKind: RowKind, subKind?: SubKind): ClicksignRole =>
  defaultRoleForSourceKind(sourceKind, subKind);

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

/**
 * Linhas de uma parte: o titular (ou o representante legal, quando PJ) e, em
 * PF casada, o cônjuge — que assina a outorga uxória com o mesmo
 * `sourceIndex`, desambiguado por `subKind`.
 */
function buildPartyRows(
  sourceKind: RowKind,
  p: LeaseParte,
  idx: number
): EditableRow[] {
  const isPJ = p.tipo_pessoa === "juridica";
  if (isPJ) {
    const rep = p.representante ?? {};
    return [
      {
        rowId: `${sourceKind}-${idx}-rep`,
        sourceKind,
        sourceIndex: idx,
        subKind: "representante",
        name: (rep.nome || "").trim() || partyName(p),
        email: (rep.email ?? "").trim(),
        // CPF do representante; CNPJ da PJ como fallback (a ClickSign recusa
        // CNPJ como documentation, mas é melhor que campo vazio na revisão).
        documentation: onlyDigits(rep.cpf) || onlyDigits(p.cnpj),
        phone: onlyDigits(rep.mobile_phone),
        isPJ: true,
        addedDuringDialog: false,
        clicksignRole: defaultRoleFor(sourceKind, "representante"),
      },
    ];
  }

  const rows: EditableRow[] = [
    {
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
    },
  ];

  // Mesmos gates da popup de venda: a lista daqui é autoritativa e pula o
  // `leaseDataToSigners`, então sem eles um ex-cônjuge voltaria pré-marcado.
  const conjugeName = (p.conjuge?.nome ?? "").trim();
  if (
    conjugeName &&
    !isExplicitlyUnmarried(p.estado_civil) &&
    p.conjuge?.incluir_como_signatario !== false
  ) {
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
  return rows;
}

function buildInitialRows(
  data: LeaseSignerData,
  variant: LeaseEnvelopeVariant,
  imobiliaria?: { nome?: string }
): EditableRow[] {
  const rows: EditableRow[] = [];
  (data.locadores ?? []).forEach((p, i) =>
    rows.push(...buildPartyRows("locador", p, i))
  );
  if (variant === "administracao") {
    // Administração: proprietários + representante da imobiliária. E-mail e
    // CPF ficam vazios de propósito — a Organization não tem representante PF
    // cadastrado e a ClickSign rejeita CNPJ como documentation (assina o
    // representante, PF); a validação obriga o operador a completar.
    rows.push({
      rowId: "imobiliaria-0",
      sourceKind: "imobiliaria",
      sourceIndex: 0,
      subKind: "representante",
      name: (imobiliaria?.nome ?? "").trim(),
      email: "",
      documentation: "",
      phone: "",
      isPJ: true,
      addedDuringDialog: false,
      clicksignRole: defaultRoleFor("imobiliaria"),
    });
    return rows;
  }
  (data.locatarios ?? []).forEach((p, i) =>
    rows.push(...buildPartyRows("locatario", p, i))
  );
  if (data.garantia?.tipo === "fiador" && data.garantia.fiador) {
    rows.push(...buildPartyRows("fiador", data.garantia.fiador, 0));
  }
  return rows;
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

export function SendLeaseEnvelopeDialog({
  open,
  onOpenChange,
  contractId,
  contractStatus,
  data,
  onSent,
  variant = "locacao",
  imobiliaria,
  leaseContractId,
}: SendLeaseEnvelopeDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [orderEnabled, setOrderEnabled] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [sigConfig, setSigConfig] = useState<SignatureConfig | null>(null);
  const [authMethod, setAuthMethod] = useState("email");
  const [witnessPickerOpen, setWitnessPickerOpen] = useState(false);
  const [inspections, setInspections] = useState<InspectionOption[]>([]);
  const [selectedInspections, setSelectedInspections] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setRows(buildInitialRows(data, variant, imobiliaria));
    setSubmitting(false);
    setOrderEnabled(false);
    setStep("edit");
    setInspections([]);
    setSelectedInspections([]);

    // Laudos prontos deste contrato: podem viajar como documento EXTRA do mesmo
    // envelope. Só na locação — a administração não tem vistoria pra anexar.
    if (leaseContractId && variant === "locacao") {
      fetch(
        `/api/locacao/inspections?status=laudo_gerado&leaseContractId=${encodeURIComponent(leaseContractId)}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { inspections?: InspectionOption[] } | null) => {
          setInspections(
            (body?.inspections ?? []).filter((i) => Boolean(i.laudoPdfUrl))
          );
        })
        .catch(() => {});
    }

    fetch("/api/signatures/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: SignatureConfig | null) => {
        if (cfg) {
          setSigConfig(cfg);
          setAuthMethod(cfg.defaultAuthMethod || "email");
        }
      })
      .catch(() => {});
    // Testemunhas NÃO são auto-injetadas: o operador as escolhe pelo botão
    // "Selecionar testemunhas" (WitnessPicker, scope "locacao").
    // Só re-inicializa ao ABRIR (lê `data` atual nesse momento); depender de
    // `data` resetaria as edições se o pai re-renderizasse com a popup aberta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validationError = useMemo(() => {
    if (rows.length === 0) return "Inclua ao menos 1 signatário";
    for (const r of rows) {
      if (r.name.trim().length < 2) return `Nome ausente em ${labelFor(r, variant)}`;
      if (!EMAIL_REGEX.test(r.email.trim()))
        return `E-mail inválido em ${labelFor(r, variant)}`;
      const d = r.documentation.replace(/\D/g, "");
      if (d && d.length !== 11 && d.length !== 14)
        return `CPF/CNPJ inválido em ${labelFor(r, variant)}`;
    }
    return null;
  }, [rows, variant]);

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

  const witnessExistingKeys = useMemo(
    () =>
      rows.flatMap((r) =>
        [r.email.trim().toLowerCase(), onlyDigits(r.documentation)].filter(Boolean)
      ),
    [rows]
  );

  const addWitnessesFromRegistry = (selected: RegistryWitness[]) => {
    setRows((prev) => {
      const existingKeys = prev.flatMap((r) =>
        [r.email.trim().toLowerCase(), onlyDigits(r.documentation)].filter(Boolean)
      );
      let nextIdx = prev.filter((r) => r.sourceKind === "testemunha").length;
      const fresh: EditableRow[] = pickNewWitnesses(selected, existingKeys).map(
        (w, i) => ({
          rowId: `testemunha-cadastro-${nextIdx + i}-${w.email}`,
          sourceKind: "testemunha",
          sourceIndex: nextIdx++,
          subKind: "titular",
          name: w.name,
          email: w.email,
          documentation: w.documentation,
          phone: w.phone,
          addedDuringDialog: true,
          clicksignRole: defaultRoleFor("testemunha"),
        })
      );
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
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
        body: JSON.stringify({
          authMethod,
          signers,
          ...(selectedInspections.length > 0
            ? { inspectionIds: selectedInspections }
            : {}),
        }),
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
          toast.error(`Faltam e-mails em ${body.missing.length} parte(s).`);
          setStep("edit");
          return;
        }
        // Limite do PLANO da conta ClickSign — mensagem montada no servidor a
        // partir da recusa da própria ClickSign.
        if (res.status === 402) {
          toast.error(body.error || "A conta ClickSign está sem envelopes disponíveis.");
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
              ? "Confira os signatários, dados e o papel de cada um."
              : "Confira a lista final de signatários antes de enviar o envelope ClickSign."}
          </DialogDescription>
        </DialogHeader>

        {step === "edit" ? (
          <div className="space-y-4 py-1">
            {rows.map((row) => (
              <SignerCard
                key={row.rowId}
                row={row}
                variant={variant}
                onChange={updateRow}
                onRemove={removeRow}
              />
            ))}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWitnessPickerOpen(true)}
                className="flex-1 border-dashed"
              >
                <UsersRound className="h-3.5 w-3.5 mr-1.5" />
                Selecionar testemunhas
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addAvulso}
                className="flex-1 border-dashed"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Adicionar assinante avulso
              </Button>
            </div>

            {inspections.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <ClipboardCheck className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    Anexar laudo de vistoria
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Vai no MESMO envelope do contrato: os signatários assinam os
                  dois documentos e a cobrança por assinante não muda.
                </p>
                {inspections.map((i) => (
                  <label
                    key={i.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedInspections.includes(i.id)}
                      onChange={(e) =>
                        setSelectedInspections((prev) =>
                          e.target.checked
                            ? [...prev, i.id]
                            : prev.filter((id) => id !== i.id)
                        )
                      }
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span>Laudo de vistoria ({i.tipo})</span>
                  </label>
                ))}
              </div>
            )}

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
                <UsersRound className="h-4 w-4" /> Signatários
              </span>
              <span className="text-sm font-medium tabular-nums">{rows.length}</span>
            </div>
          </div>
        ) : (
          <ReviewStep
            rows={rows}
            orderEnabled={orderEnabled}
            extraDocuments={inspections
              .filter((i) => selectedInspections.includes(i.id))
              .map((i) => `Laudo de vistoria (${i.tipo})`)}
          />
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

      <WitnessPicker
        open={witnessPickerOpen}
        onOpenChange={setWitnessPickerOpen}
        scope="locacao"
        existingKeys={witnessExistingKeys}
        onConfirm={addWitnessesFromRegistry}
      />
    </Dialog>
  );
}

function SignerCard({
  row,
  variant = "locacao",
  onChange,
  onRemove,
}: {
  row: EditableRow;
  variant?: LeaseEnvelopeVariant;
  onChange: (rowId: string, patch: Partial<EditableRow>) => void;
  onRemove: (rowId: string) => void;
}) {
  const docLabel = row.isPJ === true && row.subKind !== "representante" ? "CNPJ" : "CPF";
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="shrink-0 text-[11px]">
            {kindLabel(row.sourceKind, variant)}
          </Badge>
          <span className="text-sm font-medium text-foreground truncate">
            {labelFor(row, variant)}
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
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
  extraDocuments = [],
}: {
  rows: EditableRow[];
  orderEnabled: boolean;
  /** Documentos além do contrato que vão no mesmo envelope. */
  extraDocuments?: string[];
}) {
  const roleLabel = (role: ClicksignRole) =>
    ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
  return (
    <div className="space-y-3 py-1">
      {extraDocuments.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">Documentos no envelope:</span>{" "}
          {["Contrato", ...extraDocuments].join(" + ")}
        </div>
      )}
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
          <UsersRound className="h-4 w-4" /> Signatários
        </span>
        <span className="text-sm font-medium tabular-nums">{rows.length}</span>
      </div>
    </div>
  );
}

function labelFor(row: EditableRow, variant: LeaseEnvelopeVariant = "locacao"): string {
  const isRep = row.subKind === "representante" && row.sourceKind !== "imobiliaria";
  if (row.name.trim()) {
    if (isRep) return `${row.name.trim()} (representante)`;
    if (row.subKind === "conjuge") return `${row.name.trim()} (cônjuge)`;
    return row.name.trim();
  }
  if (isRep) return "Representante";
  if (row.subKind === "conjuge") return "Cônjuge";
  return `${kindLabel(row.sourceKind, variant)} ${row.sourceIndex + 1}`;
}
