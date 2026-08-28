"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { FileText, ExternalLink, ArrowLeft, ShieldCheck, Copy, Wallet, FileSignature, Trash2, FileX, RefreshCw, XOctagon, RotateCcw, Bot, Pencil, Check, CheckCircle2, ClipboardCheck, X, Archive, ArchiveRestore, Lock, LockOpen, ShieldAlert, Users, BellRing } from "lucide-react";
import { buildPartySuggestions } from "@/lib/clicksign/party-suggestions";
import { isExplicitlyUnmarried } from "@/lib/forms/estado-civil";
import { MarkLostDialog } from "@/components/pipeline/MarkLostDialog";
import { LostDealBanner } from "@/components/pipeline/LostDealBanner";
import {
  MatriculaPendenteBanner,
  pendenciasDeMatricula,
  pendenciasNaoResolvidas,
} from "@/components/pipeline/MatriculaPendenteBanner";
import { cn } from "@/lib/utils";
import type { DocumentCardData } from "@/components/forms/DocumentCard";
import { ReopenFormButton } from "@/components/forms/ReopenFormButton";
import { isFormFinished } from "@/lib/forms/form-status";
import { formPublicPath } from "@/lib/forms/form-url";
import type { SelectGroup } from "@/components/forms/NativeSelect";
import type { Assignment, DocumentKind } from "@/lib/forms/extracted-to-form";
import { buildAssignmentOptions } from "@/components/forms/steps/build-assignment-options";
import {
  buildNegotiationSummary,
  type SummarySection,
} from "@/lib/forms/negotiation-summary";
import { DealProgressTimeline } from "@/components/pipeline/DealProgressTimeline";
import { deriveDealMilestones } from "@/lib/pipeline/deal-dates";
import { DealManagerChip } from "@/components/deals/DealManagerChip";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { NO_PERMISSION_HINT } from "@/lib/security/rbac/ui";
import { PickTemplateDialog } from "@/components/contracts/PickTemplateDialog";
import { toast } from "sonner";
import Link from "next/link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Placeholder enquanto o chunk da aba baixa. Compacto de propósito — a aba
 * inicial ("dados") é estática, então isto só aparece em troca de aba.
 */
function TabLoading() {
  return (
    <div className="min-h-[120px] px-3 py-6 text-sm text-muted-foreground">
      Carregando…
    </div>
  );
}

// Code splitting: tudo que só aparece em aba não-inicial ou em dialog sai do
// chunk da página (o custo aqui é bundle/parse — o Radix Tabs já desmonta o
// conteúdo inativo). Sem `ssr: false` pra não mudar o comportamento de render.
const CertidoesTab = dynamic(
  () => import("@/components/pipeline/CertidoesTab").then((m) => m.CertidoesTab),
  { loading: () => <TabLoading /> }
);
const SignaturesTab = dynamic(
  () => import("@/components/pipeline/SignaturesTab").then((m) => m.SignaturesTab),
  { loading: () => <TabLoading /> }
);
const NewtonRequestsTab = dynamic(
  () =>
    import("@/components/pipeline/NewtonRequestsTab").then(
      (m) => m.NewtonRequestsTab
    ),
  { loading: () => <TabLoading /> }
);
const NotificationsTab = dynamic(
  () =>
    import("@/components/pipeline/NotificationsTab").then(
      (m) => m.NotificationsTab
    ),
  { loading: () => <TabLoading /> }
);
const DealSurveysTab = dynamic(
  () => import("@/components/surveys/DealSurveysTab").then((m) => m.DealSurveysTab),
  { loading: () => <TabLoading /> }
);
const CommissionChargeList = dynamic(
  () =>
    import("@/components/pipeline/CommissionChargeList").then(
      (m) => m.CommissionChargeList
    ),
  { loading: () => <TabLoading /> }
);
const AddDocumentsCard = dynamic(
  () =>
    import("@/components/pipeline/AddDocumentsCard").then(
      (m) => m.AddDocumentsCard
    ),
  { loading: () => <TabLoading /> }
);
const DocumentCard = dynamic(
  () => import("@/components/forms/DocumentCard").then((m) => m.DocumentCard),
  { loading: () => <TabLoading /> }
);
// Dialogs: sem placeholder — o gatilho já é o próprio estado de abertura.
const CommissionChargeDialog = dynamic(
  () =>
    import("@/components/pipeline/CommissionChargeDialog").then(
      (m) => m.CommissionChargeDialog
    ),
  { loading: () => null }
);
const SendAttachmentEnvelopeDialog = dynamic(
  () =>
    import("@/components/pipeline/SendAttachmentEnvelopeDialog").then(
      (m) => m.SendAttachmentEnvelopeDialog
    ),
  { loading: () => null }
);
import { FormSummarySections } from "@/components/forms/FormSummarySections";

const SendFormSummaryDialog = dynamic(
  () =>
    import("@/components/forms/SendFormSummaryDialog").then(
      (m) => m.SendFormSummaryDialog
    ),
  { loading: () => null }
);

type Parte = {
  nome?: string;
  razao_social?: string;
  tipo_pessoa?: string;
  cpf?: string;
  cnpj?: string;
  rg?: string;
  nacionalidade?: string;
  estado_civil?: string;
  profissao?: string;
  email?: string;
  mobile_phone?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  conjuge?: {
    nome?: string;
    cpf?: string;
    email?: string;
    mobile_phone?: string;
    incluir_como_signatario?: boolean;
  };
  tem_procurador?: boolean;
  // Dependentes do vendedor diligenciados junto nas certidões (2026-05-22).
  procurador?: {
    nome?: string;
    cpf?: string;
    email?: string;
    mobile_phone?: string;
    incluir_como_signatario?: boolean;
  };
  representante?: { nome?: string; cpf?: string; email?: string; mobile_phone?: string };
};

type Imovel = {
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  matricula?: string;
  cartorio?: string;
  /** "" | "possui" | "solicitar" — ausente em formulário anterior ao campo. */
  matricula_situacao?: string;
  matricula_attachment_filename?: string;
  inscricao_iptu?: string;
  descricao?: string;
};

function entityAddress(p: Parte | Imovel): string {
  const rua = (p as Parte).endereco || (p as Imovel).rua;
  const parts = [
    rua,
    p.numero && `nº ${p.numero}`,
    p.complemento,
    p.bairro && `Bairro: ${p.bairro}`,
    p.cidade && `${p.cidade}${p.uf ? `/${p.uf}` : ""}`,
    p.cep && `CEP ${p.cep}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

/** Sub-bloco de pessoa vinculada à parte (cônjuge/procurador/representante). */
function PartySubPerson({
  label,
  person,
  signs,
}: {
  label: string;
  person: { nome?: string; cpf?: string; email?: string; mobile_phone?: string };
  signs?: boolean;
}) {
  return (
    <div className="mt-1.5 rounded-md border border-dashed bg-muted/30 px-2 py-1.5">
      <p className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
        {label}
        {signs && (
          <span className="text-[10px] font-normal text-emerald-700">• assina</span>
        )}
      </p>
      <p className="text-xs">{person.nome || "—"}</p>
      <p className="text-[11px] text-muted-foreground">
        {[
          person.cpf && `CPF: ${person.cpf}`,
          person.email,
          person.mobile_phone,
        ]
          .filter(Boolean)
          .join(" · ") || "Dados incompletos"}
      </p>
    </div>
  );
}

/** Renderiza uma parte (vendedor/comprador) com todos os vínculos do form:
 *  celular, dados de PJ, cônjuge, representante e procurador. */
function PartyDetails({ p }: { p: Parte }) {
  const isPJ = p.tipo_pessoa === "juridica";
  return (
    <div className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
      <p className="font-medium">{p.nome || p.razao_social || "—"}</p>
      {isPJ ? (
        <>{p.cnpj && <p><span className="text-muted-foreground">CNPJ:</span> {p.cnpj}</p>}</>
      ) : (
        <>
          {p.cpf && <p><span className="text-muted-foreground">CPF:</span> {p.cpf}</p>}
          {p.rg && <p><span className="text-muted-foreground">RG:</span> {p.rg}</p>}
          {p.estado_civil && <p><span className="text-muted-foreground">Estado civil:</span> {p.estado_civil}</p>}
          {p.profissao && <p><span className="text-muted-foreground">Profissão:</span> {p.profissao}</p>}
        </>
      )}
      {p.email && <p><span className="text-muted-foreground">E-mail:</span> {p.email}</p>}
      {p.mobile_phone && <p><span className="text-muted-foreground">Celular:</span> {p.mobile_phone}</p>}
      <p className="text-muted-foreground text-xs">{entityAddress(p)}</p>
      {p.representante?.nome && (
        <PartySubPerson label="Representante (PJ)" person={p.representante} signs />
      )}
      {/* `signs` espelha exatamente o gate de `dealDataToSigners`: opt-out +
          e-mail presente + a sub-parte ser aplicável à parte. Antes o badge
          lia só a flag (semântica opt-in) e mentia pro operador — um cônjuge
          vindo do form público assinava sem mostrar "• assina". */}
      {p.conjuge?.nome && (
        <PartySubPerson
          label="Cônjuge"
          person={p.conjuge}
          signs={
            // `isExplicitlyUnmarried`, não `isMarried`: o mapper é leniente
            // (estado civil ausente ainda inclui), e um badge estrito voltaria
            // a mentir — só que na direção oposta.
            !isExplicitlyUnmarried(p.estado_civil) &&
            p.conjuge.incluir_como_signatario !== false &&
            Boolean(p.conjuge.email)
          }
        />
      )}
      {p.procurador?.nome && (
        <PartySubPerson
          label="Procurador"
          person={p.procurador}
          signs={
            p.tem_procurador !== false &&
            p.procurador.incluir_como_signatario !== false &&
            Boolean(p.procurador.email)
          }
        />
      )}
    </div>
  );
}

interface DealDetailProps {
  deal: {
    id: string;
    title: string;
    value: number | null;
    createdAt: Date;
    commissionPaidAt: Date | null;
    contractSignedAt: Date | null;
    chargeIssuedAt: Date | null;
    lostAt: Date | null;
    lostReason: string | null;
    archivedAt: Date | null;
    /** Gerente responsável (scalar do Deal) — o nome sai do manager-context. */
    managerUserId: string | null;
    stage: { name: string; color: string | null };
    form: {
      id: string;
      token: string;
      dataJson: unknown;
      status: string;
      createdAt: Date;
      completedAt: Date | null;
      lockedAt: Date | null;
      reopenedAt: Date | null;
      attachments: {
        id: string;
        filename: string;
        mime: string;
        category: string | null;
        url: string;
        extractedData: unknown;
        createdAt: Date;
      }[];
    } | null;
    attachments: {
      id: string;
      filename: string;
      mime: string;
      category: string | null;
      url: string;
      extractedData: unknown;
      source: string;
      createdAt: Date;
    }[];
    contracts: { id: string; version: number; status: string; template: { name: string } | null; createdAt: Date }[];
    envelopes: { closedAt: Date | null }[];
    commissionCharges: { createdAt: Date }[];
    /** Proposta que originou o deal (conversão) — chip "Origem: proposta". */
    fromProposal?: {
      id: string;
      title: string;
      convertedWithoutSignature: boolean;
    } | null;
  };
  /**
   * Newton (agente de WhatsApp) habilitado pra este tenant. Feature default OFF —
   * quem não usa o Newton não vê a aba de pedidos. Resolvido no server (page.tsx),
   * porque este componente é client e não pode ler `getOrgModules`.
   */
  newtonEnabled?: boolean;
  /** Pesquisas de satisfação habilitadas (feature vendas.pesquisas, default OFF). */
  surveysEnabled?: boolean;
  /** Seções do resumo consolidado, iguais às do PDF (calculadas no server). */
  formSummarySections?: SummarySection[];
}

const BASE_TABS = [
  "dados",
  "anexos",
  "certidoes",
  "contratos",
  "assinaturas",
  "pagamentos",
] as const;

export function DealDetail({
  deal,
  newtonEnabled = false,
  surveysEnabled = false,
  formSummarySections,
}: DealDetailProps) {
  const router = useRouter();
  const perms = usePermissions();
  // Gating de CTA (feature Gerente). Enquanto as permissões carregam, tudo
  // liberado — o header não pisca entre o primeiro paint e o fetch.
  const canCreateContract =
    perms.loading || perms.can(PERMISSION.CONTRACT_CREATE);
  const canCreateCharge =
    perms.loading || perms.can(PERMISSION.CHARGE_CREATE_FROM_DEAL);
  const canEditDeal = perms.loading || perms.can(PERMISSION.DEAL_EDIT);
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  // `?tab=newton` num tenant sem Newton cai no default em vez de abrir uma aba morta.
  const validTabs = useMemo(
    () =>
      new Set<string>([
        ...BASE_TABS,
        ...(newtonEnabled ? ["newton"] : []),
        ...(surveysEnabled ? ["pesquisas"] : []),
      ]),
    [newtonEnabled, surveysEnabled]
  );
  const initialTab = tabParam && validTabs.has(tabParam) ? tabParam : "dados";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [generating, setGenerating] = useState(false);
  // Segurança do link do formulário: token principal em estado (rotação gera
  // um novo) + travamento (congela edição pública).
  const [formToken, setFormToken] = useState(deal.form?.token ?? null);
  const [formLockedAt, setFormLockedAt] = useState<string | null>(
    deal.form?.lockedAt ? deal.form.lockedAt.toISOString() : null,
  );
  // Form enviado pelo cliente (finalize) OU nascido preso a um contrato pronto
  // (import/upload/proposta = "vinculado"). Só esses podem ser reabertos.
  const formSubmitted = deal.form
    ? isFormFinished({
        completedAt: deal.form.completedAt,
        status: deal.form.status,
      })
    : false;
  const [linkBusy, setLinkBusy] = useState<"lock" | "rotate" | "reopen" | null>(null);
  const [confirmDuplicateOpen, setConfirmDuplicateOpen] = useState(false);
  const [pickTemplateOpen, setPickTemplateOpen] = useState(false);
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [chargeDialogMode, setChargeDialogMode] = useState<
    "commission_from_deal" | "avulsa_in_deal"
  >("commission_from_deal");
  const [chargeRefreshKey, setChargeRefreshKey] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFormToo, setDeleteFormToo] = useState(false);
  const [deleteContractsDialogOpen, setDeleteContractsDialogOpen] = useState(false);
  const [deletingContracts, setDeletingContracts] = useState(false);
  const [pendingAttachmentId, setPendingAttachmentId] = useState<string | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);
  const [pendingDeleteContractId, setPendingDeleteContractId] = useState<string | null>(null);
  const [deletingContract, setDeletingContract] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);
  const [markLostDialogOpen, setMarkLostDialogOpen] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // Edição inline do título do negócio (lápis ao lado do <h1>). Reflete no
  // card do Kanban na próxima navegação (server data) via router.refresh().
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(deal.title);
  const [savingTitle, setSavingTitle] = useState(false);
  useEffect(() => setTitleDraft(deal.title), [deal.title]);

  async function handleSaveTitle() {
    const next = titleDraft.trim();
    if (!next || next === deal.title) {
      setEditingTitle(false);
      setTitleDraft(deal.title);
      return;
    }
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(d?.error || "Falha ao renomear o negócio");
        return;
      }
      toast.success("Título atualizado");
      setEditingTitle(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setSavingTitle(false);
    }
  }

  const stageName = deal.stage.name;
  const isLost = stageName === "Negócio perdido";
  const isCommissionPaid = stageName === "Comissão paga";
  const isTerminal = isLost || isCommissionPaid;

  async function handleMarkCommissionPaid() {
    setMarkingPaid(true);
    try {
      const res = await fetch(
        `/api/pipeline/deals/${deal.id}/mark-commission-paid`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Comissão marcada como paga!");
        router.refresh();
      } else {
        toast.error(data.error || "Erro ao marcar comissão paga");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setMarkingPaid(false);
    }
  }

  async function handleArchive(archived: boolean) {
    setArchiving(true);
    try {
      const res = await fetch(`/api/pipeline/deals/${deal.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(archived ? "Negócio arquivado" : "Negócio desarquivado");
        router.refresh();
      } else {
        toast.error(data.error || "Erro ao arquivar negócio");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setArchiving(false);
    }
  }

  async function handleReopen() {
    setReopening(true);
    try {
      const res = await fetch(`/api/pipeline/deals/${deal.id}/reopen`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Negócio reaberto em "${data.stageName}"`);
        router.refresh();
      } else {
        toast.error(data.error || "Erro ao reabrir negócio");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setReopening(false);
    }
  }

  // Detecta deal com contrato importado (templateId=null). UI muda em alguns
  // pontos: esconde "Confeccionar Contrato" (substituído por "Abrir contrato"),
  // mostra botão "Re-extrair dados" na aba Dados, abre porta para envelopes
  // avulsos via aba Assinaturas.
  const importedContract = deal.contracts.find((c) => c.template === null);
  const isImportedDeal = Boolean(importedContract);
  const latestImportedContractId = importedContract?.id ?? null;

  async function handleReExtract() {
    if (!latestImportedContractId) return;
    setReExtracting(true);
    try {
      const res = await fetch(
        `/api/contracts/${latestImportedContractId}/re-extract`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao re-extrair dados");
        return;
      }
      toast.success(
        `Extração concluída: ${data.fieldsCount ?? 0} campos atualizados.`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setReExtracting(false);
    }
  }

  async function doGenerateContract(templateId?: string) {
    setGenerating(true);
    const res = await fetch(
      `/api/pipeline/deals/${deal.id}/generate-contract`,
      {
        method: "POST",
        // Sem escolha manual, a chamada segue sem corpo — como sempre foi.
        ...(templateId
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ templateId }),
            }
          : {}),
      }
    );
    const data = await res.json();
    setGenerating(false);
    if (res.ok) {
      // D16: aviso persistente (só fecha no X) — o toast sobrevive à navegação
      // client-side pro contrato.
      if (data.templateNotice) {
        toast.warning(data.templateNotice, {
          duration: Infinity,
          closeButton: true,
        });
      }
      router.push(`/contracts/${data.contractId}`);
    } else {
      toast.error(data.error || "Erro ao gerar contrato");
    }
  }

  function handleGenerateContract() {
    if (deal.contracts.length > 0) {
      setConfirmDuplicateOpen(true);
      return;
    }
    doGenerateContract();
  }

  function handleCopyFormLink() {
    if (!formToken) return;
    const url = `${window.location.origin}${formPublicPath(formToken, deal.title)}`;
    navigator.clipboard.writeText(url);
    toast.success("Link do formulário copiado!");
  }

  async function handleToggleFormLock() {
    if (!formToken) return;
    const next = !formLockedAt;
    setLinkBusy("lock");
    try {
      const res = await fetch(`/api/forms/${formToken}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Falha ao atualizar travamento");
        return;
      }
      setFormLockedAt(data.lockedAt ?? null);
      toast.success(next ? "Formulário travado" : "Formulário destravado");
    } catch {
      toast.error("Erro de rede");
    } finally {
      setLinkBusy(null);
    }
  }

  async function handleRotateFormLinks() {
    if (!formToken) return;
    setLinkBusy("rotate");
    try {
      const res = await fetch(`/api/forms/${formToken}/rotate-links`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Falha ao trocar os links");
        return;
      }
      setFormToken(data.token);
      toast.success("Links trocados — os anteriores foram desativados");
    } catch {
      toast.error("Erro de rede");
    } finally {
      setLinkBusy(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const url = `/api/pipeline/deals/${deal.id}${deleteFormToo ? "?deleteForm=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const c = data?.deleted;
        toast.success(
          `Negócio excluído (${c?.contracts ?? 0} contrato(s), ${c?.attachments ?? 0} anexo(s))`
        );
        router.push("/pipeline");
      } else if (res.status === 409) {
        toast.error(data?.error || "Não foi possível excluir — envelope ClickSign em curso");
      } else {
        toast.error(data?.error || "Erro ao excluir negócio");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  async function handleDeleteContracts() {
    setDeletingContracts(true);
    try {
      const res = await fetch(`/api/pipeline/deals/${deal.id}/contracts`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const c = data?.deleted;
        toast.success(
          `${c?.contracts ?? 0} contrato(s) excluído(s) (${c?.googleDocsTrashed ?? 0} GDocs na lixeira)`
        );
        router.refresh();
      } else if (res.status === 409) {
        toast.error(data?.error || "Não foi possível excluir contratos");
      } else {
        toast.error(data?.error || "Erro ao excluir contratos");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeletingContracts(false);
      setDeleteContractsDialogOpen(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    setDeletingAttachment(true);
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Documento excluído");
        router.refresh();
      } else {
        toast.error(data?.error || "Erro ao excluir documento");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeletingAttachment(false);
      setPendingAttachmentId(null);
    }
  }

  async function handleDeleteContract(contractId: string) {
    setDeletingContract(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Rascunho excluído");
        router.refresh();
      } else {
        toast.error(data?.error || "Erro ao excluir rascunho");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeletingContract(false);
      setPendingDeleteContractId(null);
    }
  }

  const formData = deal.form?.dataJson as Record<string, unknown> | null;
  // Pendência é POR IMÓVEL: um negócio com dois imóveis à espera não pode
  // perder o aviso do segundo quando a matrícula do primeiro chega.
  const matriculaPendencias = pendenciasNaoResolvidas(
    pendenciasDeMatricula(formData),
    deal.attachments
  );
  const vendedores = (formData?.vendedores as Parte[]) || [];
  const compradores = (formData?.compradores as Parte[]) || [];
  const testemunhas =
    (formData?.testemunhas as Array<{
      nome?: string;
      cpf?: string;
      email?: string;
      incluir_como_signatario?: boolean;
    }>) || [];
  const comissao =
    (formData?.comissao as {
      corretora_tipo_pessoa?: "fisica" | "juridica";
      imobiliaria_nome?: string;
      imobiliaria_cnpj?: string;
      imobiliaria_email?: string;
      creci?: string;
      incluir_como_signatario?: boolean;
      comissionados?: Array<{
        nome?: string;
        cpf?: string;
        cnpj?: string;
        tipo_pessoa?: string;
        email?: string;
        percentual?: number;
        valor?: number;
        incluir_como_signatario?: boolean;
      }>;
    } | null) || null;
  const imoveis = (formData?.imoveis as Imovel[]) || [];
  const pagamento = formData?.pagamento as
    | {
        valor_total?: number;
        sinal_arras?: number;
        recursos_proprios?: number;
        fgts?: number;
        alienacao_fiduciaria?: number;
      }
    | undefined;

  const formatBRL = (v: number | undefined) =>
    v != null ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";

  const negotiationSummary = buildNegotiationSummary(formData);

  const formatAddress = (p: Parte | Imovel) => {
    const rua = (p as Parte).endereco || (p as Imovel).rua;
    const parts = [
      rua,
      p.numero && `nº ${p.numero}`,
      p.complemento,
      p.bairro && `Bairro: ${p.bairro}`,
      p.cidade && `${p.cidade}${p.uf ? `/${p.uf}` : ""}`,
      p.cep && `CEP ${p.cep}`,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start sm:items-center gap-4 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/pipeline">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Pipeline
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <div>
          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={titleDraft}
                disabled={savingTitle}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setTitleDraft(deal.title);
                    setEditingTitle(false);
                  }
                }}
                className="h-9 w-[min(70vw,420px)] text-lg font-semibold"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-success"
                onClick={handleSaveTitle}
                disabled={savingTitle}
                aria-label="Salvar título"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => {
                  setTitleDraft(deal.title);
                  setEditingTitle(false);
                }}
                disabled={savingTitle}
                aria-label="Cancelar edição"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="group flex items-center gap-1.5">
              <h1 className="font-display tracking-tight text-2xl font-semibold">{deal.title}</h1>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  setTitleDraft(deal.title);
                  setEditingTitle(true);
                }}
                aria-label="Editar título"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge
              style={{ backgroundColor: deal.stage.color || undefined }}
              className="text-white text-xs"
            >
              {deal.stage.name}
            </Badge>
            {deal.value != null && (
              <span className="text-sm text-muted-foreground">
                R$ {deal.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            )}
            <DealManagerChip
              dealId={deal.id}
              managerUserId={deal.managerUserId}
              managerName={null}
            />
            {deal.fromProposal && (
              <Link
                href={`/pipeline/propostas/${deal.fromProposal.id}`}
                className="inline-flex max-w-[280px] items-center gap-1 text-sm text-muted-foreground hover:underline"
                title={deal.fromProposal.title}
              >
                <FileSignature className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Origem: proposta {deal.fromProposal.title}
                </span>
                {deal.fromProposal.convertedWithoutSignature && (
                  <span className="shrink-0">(sem assinatura)</span>
                )}
              </Link>
            )}
          </div>
        </div>
        <div className="w-full sm:w-auto sm:ml-auto flex gap-2 flex-wrap">
          {deal.form && formToken && (
            <>
              {formLockedAt && (
                <Badge variant="secondary" className="gap-1 self-center">
                  <Lock className="h-3 w-3" />
                  Travado
                </Badge>
              )}
              <Button variant="outline" size="sm" asChild>
                <a
                  href={formPublicPath(formToken, deal.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Formulário
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyFormLink}
                title="Copiar link do formulário para compartilhar"
              >
                <Copy className="h-4 w-4 mr-1" />
                Copiar link
              </Button>
              <Button
                variant="outline"
                size="sm"
                asChild
                title="Links individuais por parte (vendedor/comprador) com status de preenchimento"
              >
                <Link href={`/forms/${deal.form.id}/share`}>
                  <Users className="h-4 w-4 mr-1" />
                  Links por parte
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleFormLock}
                disabled={linkBusy !== null}
                title={
                  formLockedAt
                    ? "Destravar: permite editar o formulário novamente"
                    : "Travar: congela as informações — as partes só conseguem consultar"
                }
              >
                {linkBusy === "lock" ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : formLockedAt ? (
                  <LockOpen className="h-4 w-4 mr-1" />
                ) : (
                  <Lock className="h-4 w-4 mr-1" />
                )}
                {formLockedAt ? "Destravar" : "Travar"}
              </Button>
              <ReopenFormButton
                token={formToken}
                submitted={formSubmitted}
                reopenedAt={
                  deal.form.reopenedAt
                    ? deal.form.reopenedAt.toISOString()
                    : null
                }
                disabled={linkBusy !== null}
                onReopened={() => setFormLockedAt(null)}
                onBusyChange={(b) => setLinkBusy(b ? "reopen" : null)}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={linkBusy !== null}
                    title="Trocar o link (revoga o acesso de quem já tem o link atual, mantém os dados)"
                  >
                    {linkBusy === "rotate" ? (
                      <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Trocar link
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-amber-500" />
                      Trocar todos os links?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      O link do formulário e os links de cada parte atuais vão
                      parar de funcionar imediatamente. Quem já recebeu algum
                      deles perde o acesso. Os dados preenchidos são mantidos.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRotateFormLinks}>
                      Trocar links
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {isImportedDeal && latestImportedContractId ? (
            <Button size="sm" asChild>
              <Link href={`/contracts/${latestImportedContractId}`}>
                <FileText className="h-4 w-4 mr-1" />
                Abrir contrato
              </Link>
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={handleGenerateContract}
                disabled={generating || !canCreateContract}
                title={canCreateContract ? undefined : NO_PERMISSION_HINT}
              >
                <FileText className="h-4 w-4 mr-1" />
                {generating ? "Gerando..." : "Confeccionar Contrato"}
              </Button>
              {/* Caminho secundário de propósito: o automático acerta quase
                  sempre, e cada escolha manual é uma chance de errar. */}
              {canCreateContract && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPickTemplateOpen(true)}
                  disabled={generating}
                >
                  Escolher outro modelo
                </Button>
              )}
            </>
          )}
          {stageName === "Cobrança emitida" && (
            <Button
              size="sm"
              variant="default"
              className="bg-green-600 hover:bg-green-700"
              onClick={handleMarkCommissionPaid}
              disabled={markingPaid}
            >
              <Wallet className="h-4 w-4 mr-1" />
              {markingPaid ? "Marcando..." : "Marcar comissão paga"}
            </Button>
          )}
          {isLost && (
            <Button
              size="sm"
              variant="default"
              onClick={handleReopen}
              disabled={reopening}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              {reopening ? "Reabrindo..." : "Reabrir negócio"}
            </Button>
          )}
          {!isTerminal && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/20"
              onClick={() => setMarkLostDialogOpen(true)}
            >
              <XOctagon className="h-4 w-4 mr-1" />
              Marcar como perdido
            </Button>
          )}
          {deal.contracts.length > 0 && canEditDeal && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setDeleteContractsDialogOpen(true)}
            >
              <FileX className="h-4 w-4 mr-1" />
              Excluir contratos
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleArchive(deal.archivedAt === null)}
            disabled={archiving}
          >
            {deal.archivedAt === null ? (
              <>
                <Archive className="h-4 w-4 mr-1" />
                {archiving ? "Arquivando..." : "Arquivar"}
              </>
            ) : (
              <>
                <ArchiveRestore className="h-4 w-4 mr-1" />
                {archiving ? "Desarquivando..." : "Desarquivar"}
              </>
            )}
          </Button>
          {canEditDeal && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Excluir negócio
            </Button>
          )}
        </div>
      </div>

      {/* Banner de perdido (compartilhado com locação) */}
      {isLost && deal.lostAt && (
        <LostDealBanner lostAt={deal.lostAt} lostReason={deal.lostReason} />
      )}

      {/* Matrícula atualizada a solicitar — declarada pelo cliente no
          formulário. Some sozinho quando a matrícula chega (upload manual ou
          certidão emitida), e não aparece em negócio perdido: lá a pendência
          não é acionável. */}
      {!isLost && (
        <MatriculaPendenteBanner
          pendencias={matriculaPendencias}
          onVerAnexos={() => setActiveTab("anexos")}
        />
      )}

      {/* Timeline horizontal — 6 stages do funil + datas-marco SLA */}
      {!isLost && (
        <DealProgressTimeline
          variant="full"
          currentStageName={deal.stage.name}
          {...deriveDealMilestones(deal)}
        />
      )}

      <MarkLostDialog
        dealId={deal.id}
        open={markLostDialogOpen}
        onOpenChange={setMarkLostDialogOpen}
      />

      <AlertDialog
        open={deleteContractsDialogOpen}
        onOpenChange={setDeleteContractsDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir todos os contratos deste negócio?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Apagar <strong>{deal.contracts.length}</strong> contrato(s) e
                  todas suas versões. Os Google Docs vão para a lixeira do Drive.
                </p>
                <p>O negócio e o formulário continuam intactos.</p>
                <p className="font-medium">Não pode ser desfeito.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingContracts}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteContracts}
              disabled={deletingContracts}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingContracts ? "Excluindo..." : "Excluir contratos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingAttachmentId}
        onOpenChange={(open) => !open && setPendingAttachmentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo sai da pasta e vai para &quot;Documentos removidos&quot;, logo
              abaixo — dá para restaurar depois. Certidões emitidas que apontavam
              para este documento ficam órfãs (não são apagadas).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAttachment}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingAttachmentId && handleDeleteAttachment(pendingAttachmentId)}
              disabled={deletingAttachment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAttachment ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingDeleteContractId}
        onOpenChange={(open) => !open && setPendingDeleteContractId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este rascunho?</AlertDialogTitle>
            <AlertDialogDescription>
              O contrato (versão rascunho) será removido, junto com comentários,
              sugestões e histórico. O Google Doc vai para a lixeira do Drive.
              Não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingContract}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                pendingDeleteContractId &&
                handleDeleteContract(pendingDeleteContractId)
              }
              disabled={deletingContract}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingContract ? "Excluindo..." : "Excluir rascunho"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir negócio "{deal.title}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Esta ação remove em cascata:</p>
                <ul className="list-disc pl-5 text-sm">
                  <li>{deal.contracts.length} contrato(s) e suas versões (Google Docs vão pra lixeira do Drive)</li>
                  <li>{deal.attachments.length} anexo(s)</li>
                  <li>Todas as certidões emitidas neste deal</li>
                  <li>Histórico de alterações, comentários e sugestões</li>
                </ul>
                <label className="flex items-center gap-2 mt-3 text-sm">
                  <input
                    type="checkbox"
                    checked={deleteFormToo}
                    onChange={(e) => setDeleteFormToo(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  Excluir também o formulário de origem (não recuperável)
                </label>
                <p className="font-medium pt-2">Não pode ser desfeito.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="anexos">
            Documentos ({(deal.form?.attachments.length ?? 0) || deal.attachments.length})
          </TabsTrigger>
          <TabsTrigger value="certidoes">
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Certidões
          </TabsTrigger>
          <TabsTrigger value="contratos">
            Contratos ({deal.contracts.length} {deal.contracts.length === 1 ? "versão" : "versões"})
          </TabsTrigger>
          <TabsTrigger value="assinaturas">
            <FileSignature className="h-3.5 w-3.5 mr-1" />
            Assinaturas
          </TabsTrigger>
          <TabsTrigger value="pagamentos">
            <Wallet className="h-3.5 w-3.5 mr-1" />
            Pagamentos
          </TabsTrigger>
          <TabsTrigger value="notificacoes">
            <BellRing className="h-3.5 w-3.5 mr-1" />
            Notificações
          </TabsTrigger>
          {newtonEnabled && (
            <TabsTrigger value="newton">
              <Bot className="h-3.5 w-3.5 mr-1" />
              Pendências
            </TabsTrigger>
          )}
          {surveysEnabled && (
            <TabsTrigger value="pesquisas">
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
              Pesquisas
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          {deal.form && (
            <div className="mb-3 flex items-center justify-end">
              <SendFormSummaryDialog dealId={deal.id} />
            </div>
          )}
          {isImportedDeal && (
            <div className="mb-3 flex items-center justify-between rounded-md border border-dashed bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                Dados extraídos do contrato importado pelo OCR. Caso algum
                campo esteja faltando, refaça a extração.
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReExtract}
                disabled={reExtracting || !canCreateContract}
                title={canCreateContract ? undefined : NO_PERMISSION_HINT}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5 mr-1",
                    reExtracting && "animate-spin"
                  )}
                />
                {reExtracting ? "Extraindo..." : "Re-extrair dados"}
              </Button>
            </div>
          )}
          {formData ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Vendedor(es)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {vendedores.length > 0 ? (
                      vendedores.map((v, i) => <PartyDetails key={i} p={v} />)
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Comprador(es)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {compradores.length > 0 ? (
                      compradores.map((c, i) => <PartyDetails key={i} p={c} />)
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Imóvel(is)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {imoveis.length > 0 ? (
                      imoveis.map((im, i) => (
                        <div key={i} className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{formatAddress(im)}</p>
                          {im.matricula && <p><span className="text-muted-foreground">Matrícula:</span> {im.matricula}</p>}
                          {im.cartorio && <p><span className="text-muted-foreground">Cartório:</span> {im.cartorio}</p>}
                          {/* Situação da matrícula ATUALIZADA — o que decide se
                              a diligência pode seguir. Âmbar quando pendente,
                              pra puxar o olho junto do banner do topo. */}
                          {im.matricula_situacao === "solicitar" && (
                            <p className="text-amber-700 dark:text-amber-400">
                              <span className="text-muted-foreground">Matrícula atualizada:</span>{" "}
                              A ser solicitada
                            </p>
                          )}
                          {im.matricula_situacao === "possui" && (
                            <p>
                              <span className="text-muted-foreground">Matrícula atualizada:</span>{" "}
                              {im.matricula_attachment_filename
                                ? `Anexada (${im.matricula_attachment_filename})`
                                : "Anexada ao formulário"}
                            </p>
                          )}
                          {im.inscricao_iptu && <p><span className="text-muted-foreground">Inscrição IPTU:</span> {im.inscricao_iptu}</p>}
                          {im.descricao && <p className="text-muted-foreground text-xs">{im.descricao}</p>}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Pagamento</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-1 text-sm pt-0">
                    <p><span className="text-muted-foreground">Valor total:</span> <strong>{formatBRL(pagamento?.valor_total)}</strong></p>
                    {pagamento?.sinal_arras ? <p><span className="text-muted-foreground">Sinal:</span> {formatBRL(pagamento.sinal_arras)}</p> : null}
                    {pagamento?.recursos_proprios ? <p><span className="text-muted-foreground">Recursos próprios:</span> {formatBRL(pagamento.recursos_proprios)}</p> : null}
                    {pagamento?.alienacao_fiduciaria ? <p><span className="text-muted-foreground">Financiamento:</span> {formatBRL(pagamento.alienacao_fiduciaria)}</p> : null}
                    {pagamento?.fgts ? <p><span className="text-muted-foreground">FGTS:</span> {formatBRL(pagamento.fgts)}</p> : null}
                  </CardContent>
                </details>
              </Card>

              {(comissao?.comissionados?.length || comissao?.imobiliaria_nome) ? (
                <Card>
                  <details open>
                    <summary className="cursor-pointer list-none">
                      <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm">Comissão / Corretagem</CardTitle>
                        <span className="text-xs text-muted-foreground">▾ detalhes</span>
                      </CardHeader>
                    </summary>
                    <CardContent className="space-y-3 pt-0">
                      {((comissao?.comissionados?.length
                        ? comissao.comissionados
                        : [{
                            nome: comissao?.imobiliaria_nome,
                            cnpj: comissao?.imobiliaria_cnpj,
                            email: comissao?.imobiliaria_email,
                            tipo_pessoa: comissao?.corretora_tipo_pessoa,
                          }]) as Array<{
                        nome?: string;
                        cpf?: string;
                        cnpj?: string;
                        email?: string;
                        tipo_pessoa?: string;
                        percentual?: number;
                        valor?: number;
                        papel?: string;
                      }>).map((c, i) => (
                        <div key={i} className="space-y-0.5 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{c.nome || "—"}</p>
                          {c.papel && <p className="text-xs"><span className="text-muted-foreground">Papel:</span> {c.papel}</p>}
                          {(c.cnpj || c.cpf) && <p className="text-xs"><span className="text-muted-foreground">{c.cnpj ? "CNPJ" : "CPF"}:</span> {c.cnpj || c.cpf}</p>}
                          {typeof c.percentual === "number" && c.percentual > 0 && <p className="text-xs"><span className="text-muted-foreground">Percentual:</span> {c.percentual}%</p>}
                          {typeof c.valor === "number" && c.valor > 0 && <p className="text-xs"><span className="text-muted-foreground">Valor:</span> {formatBRL(c.valor)}</p>}
                          {c.email && <p className="text-xs"><span className="text-muted-foreground">E-mail:</span> {c.email}</p>}
                        </div>
                      ))}
                    </CardContent>
                  </details>
                </Card>
              ) : null}

              {testemunhas.length > 0 ? (
                <Card>
                  <details open>
                    <summary className="cursor-pointer list-none">
                      <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm">Testemunhas</CardTitle>
                        <span className="text-xs text-muted-foreground">▾ detalhes</span>
                      </CardHeader>
                    </summary>
                    <CardContent className="space-y-2 pt-0">
                      {testemunhas.map((t, i) => (
                        <div key={i} className="text-sm border-b last:border-b-0 pb-1.5 last:pb-0">
                          <p className="font-medium">{t.nome || "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {[t.cpf && `CPF: ${t.cpf}`, t.email].filter(Boolean).join(" · ") || "Dados incompletos"}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </details>
                </Card>
              ) : null}

              {negotiationSummary.length > 0 ? (
                <Card className="md:col-span-2">
                  <details open>
                    <summary className="cursor-pointer list-none">
                      <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm">Resumo da negociação</CardTitle>
                        <span className="text-xs text-muted-foreground">▾ detalhes</span>
                      </CardHeader>
                    </summary>
                    <CardContent className="grid gap-4 sm:grid-cols-3 pt-0">
                      {negotiationSummary.map((section: SummarySection) => (
                        <div key={section.title} className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {section.title}
                          </p>
                          {section.rows.map((row, i) => (
                            <p key={i} className="text-sm">
                              <span className="text-muted-foreground">{row.label}:</span>{" "}
                              {row.value}
                            </p>
                          ))}
                        </div>
                      ))}
                    </CardContent>
                  </details>
                </Card>
              ) : null}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum dado de formulário vinculado.
              </CardContent>
            </Card>
          )}

          {/* Espelho exato do PDF do resumo. Os cards acima são a visão rápida;
              aqui não pode faltar nada que o cliente preencheu — a etapa de
              posse/título, as observações e a configuração contratual só
              existiam no PDF. */}
          <div className="mt-4">
            <FormSummarySections
              sections={formSummarySections ?? []}
              description="Tudo o que foi preenchido no formulário — o mesmo conteúdo do PDF do resumo."
            />
          </div>
        </TabsContent>

        <TabsContent value="anexos" className="mt-4">
          <DocumentsTab
            dealId={deal.id}
            formAttachments={deal.form?.attachments ?? []}
            formToken={deal.form?.token ?? null}
            fallbackAttachments={deal.attachments}
            vendedores={vendedores}
            compradores={compradores}
            imoveis={imoveis}
            onRequestRemoveDealAttachment={(id) => setPendingAttachmentId(id)}
          />
        </TabsContent>

        <TabsContent value="certidoes" className="mt-4">
          <CertidoesTab
            dealId={deal.id}
            vendedores={vendedores}
            compradores={compradores}
            imoveis={imoveis}
          />
        </TabsContent>

        <TabsContent value="contratos" className="mt-4">
          <div className="space-y-3">
            {deal.contracts.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground mb-4">
                    Nenhum contrato gerado.
                  </p>
                  <Button
                    onClick={handleGenerateContract}
                    disabled={generating || !canCreateContract}
                    title={canCreateContract ? undefined : NO_PERMISSION_HINT}
                  >
                    {generating ? "Gerando..." : "Confeccionar Contrato"}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              deal.contracts.map((contract) => (
                <Link key={contract.id} href={`/contracts/${contract.id}`}>
                  <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                    <CardContent className="py-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">
                          {contract.template?.name ?? "Contrato importado"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Versão {contract.version} -{" "}
                          {contract.createdAt.toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{contract.status}</Badge>
                        {contract.status === "rascunho" && canEditDeal && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:bg-destructive/10"
                            title="Excluir rascunho"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setPendingDeleteContractId(contract.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="assinaturas" className="mt-4">
          <SignaturesTab
            contracts={deal.contracts.map((c) => ({
              id: c.id,
              version: c.version,
              status: c.status,
              templateName: c.template?.name ?? "Contrato importado",
            }))}
            vendedores={vendedores}
            compradores={compradores}
            testemunhas={testemunhas}
            comissao={comissao}
            dealId={deal.id}
            attachments={deal.attachments.map((a) => ({
              id: a.id,
              filename: a.filename,
              mime: a.mime,
              category: a.category,
            }))}
          />
        </TabsContent>

        <TabsContent value="pagamentos" className="mt-4">
          <div className="space-y-4">
            {!deal.contracts.some((c) => c.status === "aprovado") && (
              <div className="p-3 border rounded-md bg-amber-50 border-amber-300 text-sm text-amber-900 flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Sem contrato aprovado.</p>
                  <p className="text-xs mt-0.5">
                    Para cobrar a comissão a partir do contrato (com pagador, valor
                    e splits pré-preenchidos), aprove a versão atual na aba{" "}
                    <button
                      type="button"
                      onClick={() => setActiveTab("contratos")}
                      className="underline font-medium hover:text-amber-950"
                    >
                      Contratos
                    </button>
                    . Você pode gerar cobrança avulsa neste deal sem aprovação.
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-lg font-semibold">Cobranças</h3>
                <p className="text-sm text-muted-foreground">
                  Gere cobranças de comissão a partir do contrato aprovado.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => {
                    const hasApproved = deal.contracts.some(
                      (c) => c.status === "aprovado"
                    );
                    if (!hasApproved) {
                      toast.error(
                        "Aprove um contrato primeiro — abrindo aba Contratos"
                      );
                      setActiveTab("contratos");
                      return;
                    }
                    setChargeDialogMode("commission_from_deal");
                    setChargeDialogOpen(true);
                  }}
                  disabled={!canCreateCharge}
                  title={canCreateCharge ? undefined : NO_PERMISSION_HINT}
                >
                  <Wallet className="h-4 w-4 mr-1" />
                  Cobrança de comissão
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setChargeDialogMode("avulsa_in_deal");
                    setChargeDialogOpen(true);
                  }}
                  disabled={!canCreateCharge}
                  title={canCreateCharge ? undefined : NO_PERMISSION_HINT}
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Avulsa
                </Button>
              </div>
            </div>
            <CommissionChargeList key={chargeRefreshKey} dealId={deal.id} />
          </div>
        </TabsContent>

        <TabsContent value="notificacoes" className="mt-4">
          <NotificationsTab dealId={deal.id} />
        </TabsContent>

        {newtonEnabled && (
          <TabsContent value="newton" className="mt-4">
            <NewtonRequestsTab dealId={deal.id} />
          </TabsContent>
        )}
        {surveysEnabled && (
          <TabsContent value="pesquisas" className="mt-4">
            <DealSurveysTab dealId={deal.id} />
          </TabsContent>
        )}
      </Tabs>

      <CommissionChargeDialog
        dealId={deal.id}
        open={chargeDialogOpen}
        onOpenChange={setChargeDialogOpen}
        onCreated={() => setChargeRefreshKey((k) => k + 1)}
        mode={chargeDialogMode}
      />

      <PickTemplateDialog
        open={pickTemplateOpen}
        onOpenChange={setPickTemplateOpen}
        dealId={deal.id}
        hasContract={deal.contracts.length > 0}
        onConfirm={(templateId) => doGenerateContract(templateId)}
      />

      <AlertDialog open={confirmDuplicateOpen} onOpenChange={setConfirmDuplicateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar nova versão do contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Este negócio já possui {deal.contracts.length} versão(ões). A nova versão (V{Math.max(0, ...deal.contracts.map((c) => c.version)) + 1}) será gerada a partir do template padrão com os dados atuais do negócio.
              <br /><br />
              <strong>Atenção:</strong> as edições manuais ou via Chat IA feitas na versão anterior <strong>não serão transferidas automaticamente</strong>. O histórico das versões anteriores é mantido para consulta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDuplicateOpen(false);
                doGenerateContract();
              }}
            >
              Criar Nova Versão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormAttachmentLite {
  id: string;
  filename: string;
  mime: string;
  category: string | null;
  url: string;
  extractedData: unknown;
  createdAt: Date;
}

interface FallbackAttachment {
  id: string;
  filename: string;
  mime: string;
  category: string | null;
  url: string;
  extractedData: unknown;
  source: string;
  createdAt: Date;
}

/**
 * Agrupamento de docs na aba Documentos. Cônjuges, representantes e
 * procuradores são exibidos junto com a parte titular (vendedor/comprador) —
 * não criam grupo próprio na visualização do deal pra evitar fragmentação.
 */
type DocGroupKind = "vendedor" | "comprador" | "imovel" | "outro";

const KIND_LABELS: Record<DocGroupKind, string> = {
  vendedor: "Parte Vendedora",
  comprador: "Parte Compradora",
  imovel: "Imóvel",
  outro: "Outros",
};

// Categorias de DealAttachment que são certidões/relatórios emitidos pela
// esteira (Infosimples, Serasa, relatório consolidado). Agrupadas numa seção
// dedicada na aba Documentos em vez de espalhadas por parte/imóvel.
const CERTIDAO_CATS = new Set(["certidao", "relatorio_certidoes"]);
// Documentos assinados (ClickSign) — destacados na pasta pra fácil identificação.
const SIGNED_CATS = new Set([
  "contrato_assinado",
  "documento_assinado",
  "contrato_administracao_assinado",
]);

function groupKindOf(kind: DocumentKind): DocGroupKind {
  if (
    kind === "vendedor" ||
    kind === "conjuge_vendedor" ||
    kind === "representante_vendedor" ||
    kind === "procurador_vendedor"
  ) {
    return "vendedor";
  }
  if (
    kind === "comprador" ||
    kind === "conjuge_comprador" ||
    kind === "representante_comprador" ||
    kind === "procurador_comprador"
  ) {
    return "comprador";
  }
  if (kind === "imovel") return "imovel";
  return "outro";
}

// Certidão de casamento entrou aqui em 2026-07-31: é doc de pessoa (qualifica
// o casal), e ficar de fora fazia o fallback jogá-la em "Outros".
const PERSON_CATS = new Set([
  "rg",
  "cpf",
  "cnh",
  "procuracao",
  "comprovante_residencia",
  "certidao_casamento",
]);
const PROPERTY_CATS = new Set(["matricula", "iptu", "escritura"]);

function resolveKind(
  category: string | null,
  extracted: Record<string, unknown> | null
): DocumentKind {
  const assignment = extracted?.assignment as Assignment | undefined;
  if (assignment?.kind) return assignment.kind;
  if (category && PROPERTY_CATS.has(category)) return "imovel";
  if (category && PERSON_CATS.has(category)) return "vendedor";
  return "outro";
}

/**
 * H.6 (Phase H, 2026-04-18) — rematch contra partes FINAIS do deal.
 * Se o CPF/nome extraído do doc bate com uma parte no dataJson atual
 * (possivelmente corrigida nas etapas 1-2 após o upload), sobrescreve
 * o assignment stored. Garante que correção manual de partes propaga
 * para a aba Documentos sem rework.
 */
function rematchAssignment(
  stored: Assignment | undefined,
  fields: Record<string, unknown> | null,
  vendedores: Parte[],
  compradores: Parte[]
): Assignment | undefined {
  if (!fields) return stored;
  const cpfDigits = typeof fields.cpf_numero === "string"
    ? fields.cpf_numero.replace(/\D/g, "")
    : null;
  const nome = typeof fields.nome_completo === "string"
    ? fields.nome_completo.trim().toLowerCase()
    : typeof fields.titular_nome === "string"
    ? fields.titular_nome.trim().toLowerCase()
    : null;
  const matchIn = (arr: Parte[]): number | null => {
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const pCpf = typeof p.cpf === "string" ? p.cpf.replace(/\D/g, "") : null;
      if (cpfDigits && pCpf && cpfDigits.length === 11 && cpfDigits === pCpf) return i;
      const pNome = typeof p.nome === "string" ? p.nome.trim().toLowerCase() : null;
      if (nome && pNome && nome === pNome) return i;
    }
    return null;
  };
  const vMatch = matchIn(vendedores);
  if (vMatch !== null) return { kind: "vendedor", index: vMatch };
  const cMatch = matchIn(compradores);
  if (cMatch !== null) return { kind: "comprador", index: cMatch };
  return stored;
}

function DocumentsTab({
  dealId,
  formAttachments,
  formToken,
  fallbackAttachments,
  vendedores,
  compradores,
  imoveis,
  onRequestRemoveDealAttachment,
}: {
  dealId: string;
  formAttachments: FormAttachmentLite[];
  formToken: string | null;
  fallbackAttachments: FallbackAttachment[];
  vendedores: Parte[];
  compradores: Parte[];
  imoveis: Imovel[];
  /** Callback chamado quando o usuário clica no X de um DealAttachment
   *  (Infosimples ou manual). Pai abre AlertDialog de confirmação. */
  onRequestRemoveDealAttachment?: (attachmentId: string) => void;
}) {
  const router = useRouter();
  const docPerms = usePermissions();
  // Gating do "Enviar para assinatura" nos cards (feature Gerente); libera
  // enquanto carrega pra não piscar.
  const canSendEnvelope =
    docPerms.loading || docPerms.can(PERMISSION.ENVELOPE_SEND);
  // OCR seletivo: ids em voo mostram spinner. Diálogo de assinatura por card.
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  const [signAttachmentId, setSignAttachmentId] = useState<string | null>(null);
  // Cópia sob demanda de FormAttachment → DealAttachment (mover/assinar).
  const [promotingIds, setPromotingIds] = useState<Set<string>>(new Set());
  // PDFs recém-copiados do form, disponíveis no diálogo de assinatura ANTES do
  // router.refresh re-hidratar signablePdfs (evita dropdown vazio no preselect).
  const [extraSignable, setExtraSignable] = useState<
    Array<{ id: string; filename: string; mime: string; category: string | null }>
  >([]);
  // Set para identificar quais cards são DealAttachment (têm rota DELETE
  // /api/deals/[dealId]/attachments/[id]). FormAttachments têm sua rota
  // própria mas não é exposto remoção daqui (só dentro do form público).
  const dealAttachmentIds = new Set(fallbackAttachments.map((a) => a.id));
  // Dedupe form↔deal: no finalize os FormAttachments são copiados pra
  // DealAttachment reusando a MESMA url. O DealAttachment é canônico (auth,
  // editável/mov./delet. por aqui), então escondemos o FormAttachment quando
  // já existe a cópia no deal. `formByUrl` deixa a cópia herdar o assignment
  // do form pra deals legados cuja cópia veio sem extractedData.
  const dealUrls = new Set(fallbackAttachments.map((a) => a.url));
  const formByUrl = new Map(formAttachments.map((f) => [f.url, f]));
  const visibleFormAttachments = formAttachments.filter(
    (f) => !dealUrls.has(f.url)
  );
  const hasFormAttachments = visibleFormAttachments.length > 0 && formToken;
  // Certidões emitidas (Infosimples + Serasa) e relatórios consolidados —
  // independem do source. Vão pra seção dedicada "Certidões".
  const certidaoAttachments = fallbackAttachments.filter(
    (att) => att.category != null && CERTIDAO_CATS.has(att.category)
  );
  const certidaoIds = new Set(certidaoAttachments.map((a) => a.id));
  // Demais anexos Infosimples (sem categoria de certidão — raro) seguem o
  // agrupamento por parte via assignment.
  const infosimplesAttachments = fallbackAttachments.filter(
    (att) => att.source === "infosimples" && !certidaoIds.has(att.id)
  );
  const manualFallback = fallbackAttachments.filter(
    (att) => att.source !== "infosimples" && !certidaoIds.has(att.id)
  );
  // Docs manuais (upload do usuário) elegíveis a OCR/aplicar/assinatura — não
  // certidões nem Infosimples (auto-classificados). PDFs daqui também podem ir
  // pra assinatura.
  const ocrEligibleIds = new Set(manualFallback.map((a) => a.id));
  // PDFs da pasta (manuais) disponíveis pra envio de assinatura via diálogo.
  const signablePdfs = manualFallback
    .filter((a) => a.mime === "application/pdf")
    .map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, category: a.category }));
  // Titular + cônjuge + procurador + representante legal da PJ, com papel
  // default já resolvido. Ver lib/clicksign/party-suggestions.ts.
  const partySuggestions = buildPartySuggestions(vendedores, compradores);

  const hasAnyContent =
    hasFormAttachments ||
    certidaoAttachments.length > 0 ||
    infosimplesAttachments.length > 0 ||
    manualFallback.length > 0;

  const groups: Record<DocGroupKind, DocumentCardData[]> = {
    vendedor: [],
    comprador: [],
    imovel: [],
    outro: [],
  };

  // Certidões + relatórios: seção própria, subdividida por parte/imóvel a
  // partir do `assignment` que o executor persiste em cada anexo. O relatório
  // consolidado (sem assignment) cai em "Gerais".
  type CertidaoSubGroup = { key: string; label: string; order: number; rows: DocumentCardData[] };
  const certidaoSubMap = new Map<string, CertidaoSubGroup>();
  const ensureSub = (key: string, label: string, order: number): CertidaoSubGroup => {
    let g = certidaoSubMap.get(key);
    if (!g) {
      g = { key, label, order, rows: [] };
      certidaoSubMap.set(key, g);
    }
    return g;
  };
  for (const att of certidaoAttachments) {
    const card: DocumentCardData = {
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: `/api/deals/${dealId}/attachments/${att.id}/file`,
      status: "ready",
      category: att.category,
      fields: null,
      confidence: null,
      assignment: { kind: "outro", index: 0 },
    };
    const extracted = (att.extractedData as Record<string, unknown> | null) || null;
    const assignment = extracted?.assignment as Assignment | undefined;
    if (att.category === "relatorio_certidoes" || !assignment) {
      ensureSub("gerais", "Gerais", 999).rows.push(card);
      continue;
    }
    const normalized = groupKindOf(assignment.kind);
    const idx = assignment.index ?? 0;
    if (normalized === "vendedor") {
      ensureSub(`v-${idx}`, `Vendedor: ${vendedores[idx]?.nome ?? `Parte ${idx + 1}`}`, idx).rows.push(card);
    } else if (normalized === "comprador") {
      ensureSub(`c-${idx}`, `Comprador: ${compradores[idx]?.nome ?? `Parte ${idx + 1}`}`, 100 + idx).rows.push(card);
    } else if (normalized === "imovel") {
      ensureSub(`i-${idx}`, `Imóvel ${idx + 1}`, 200 + idx).rows.push(card);
    } else {
      ensureSub("outras", "Outras", 900).rows.push(card);
    }
  }
  const certidaoSubGroups = Array.from(certidaoSubMap.values()).sort(
    (a, b) => a.order - b.order
  );
  const certidaoTotal = certidaoSubGroups.reduce((acc, g) => acc + g.rows.length, 0);

  // Form-uploaded documents (OCR autofill) — só os que ainda não têm cópia
  // no deal (visibleFormAttachments); os duplicados aparecem como DealAttachment.
  if (hasFormAttachments) {
    for (const att of visibleFormAttachments) {
      const extracted = (att.extractedData as Record<string, unknown> | null) || null;
      const fields = (extracted?.fields as Record<string, unknown> | null) ?? null;
      const confidence =
        typeof extracted?.confidence === "number"
          ? (extracted.confidence as number)
          : null;
      const storedAssignment = extracted?.assignment as Assignment | undefined;
      // H.6 — rematch against final parties (handles user correction in steps 1-2)
      const rematched = rematchAssignment(storedAssignment, fields, vendedores, compradores);
      const assignment = rematched ?? {
        kind: resolveKind(att.category, extracted),
        index: 0,
      };
      const card: DocumentCardData = {
        id: att.id,
        filename: att.filename,
        mime: att.mime,
        fileUrl: `/api/forms/${formToken}/attachments/${att.id}/file`,
        status: "ready",
        category: att.category,
        fields,
        confidence,
        assignment,
      };
      groups[groupKindOf(assignment.kind)].push(card);
    }
  }

  // Infosimples certidões — grouped via extractedData.assignment persisted by the executor
  for (const att of infosimplesAttachments) {
    const extracted = (att.extractedData as Record<string, unknown> | null) || null;
    const assignment = (extracted?.assignment as Assignment | undefined) ?? {
      kind: "outro" as DocumentKind,
      index: 0,
    };
    const card: DocumentCardData = {
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: `/api/deals/${dealId}/attachments/${att.id}/file`,
      status: "ready",
      category: att.category,
      fields: null,
      confidence: null,
      assignment,
    };
    groups[groupKindOf(assignment.kind)].push(card);
  }

  // DealAttachments manuais / copiados do form. Lê o assignment do próprio
  // extractedData; pra cópias legadas sem ele, herda do FormAttachment de
  // mesma url (formByUrl). Sem nada → "Outros". Dedupe por url cobre deals
  // legados que acumularam linhas duplicadas (cópia rodada > 1× antes do fix).
  const seenManualUrls = new Set<string>();
  for (const att of manualFallback) {
    if (seenManualUrls.has(att.url)) continue;
    seenManualUrls.add(att.url);
    const extracted = (att.extractedData as Record<string, unknown> | null) || null;
    const formMatch = formByUrl.get(att.url);
    const formExtracted =
      (formMatch?.extractedData as Record<string, unknown> | null) || null;
    const assignment =
      (extracted?.assignment as Assignment | undefined) ??
      (formExtracted?.assignment as Assignment | undefined) ?? {
        kind: "outro" as DocumentKind,
        index: 0,
      };
    const fields =
      (extracted?.fields as Record<string, unknown> | null) ??
      (formExtracted?.fields as Record<string, unknown> | null) ??
      null;
    // Status do OCR seletivo: em voo → spinner; com fields → pronto; sem fields
    // mas OCR-ável (PDF/imagem) → aguardando (mostra "Extrair com IA"); senão
    // (tipo não-OCR-ável) → só armazenado (pronto, sem botão de IA).
    const ocrable = att.mime === "application/pdf" || att.mime.startsWith("image/");
    const status: DocumentCardData["status"] = extractingIds.has(att.id)
      ? "extracting"
      : fields
        ? "ready"
        : ocrable
          ? "awaiting"
          : "ready";
    const card: DocumentCardData = {
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: `/api/deals/${dealId}/attachments/${att.id}/file`,
      status,
      category: att.category,
      fields,
      confidence:
        typeof extracted?.confidence === "number"
          ? (extracted.confidence as number)
          : null,
      assignment,
      applied: extracted?.applied === true,
      extractingSince: extractingIds.has(att.id) ? Date.now() : null,
    };
    groups[groupKindOf(assignment.kind)].push(card);
  }

  const kinds: DocGroupKind[] = ["vendedor", "comprador", "imovel", "outro"];

  // Opções do seletor "Mover para…" (pastas = partes/sub-slots/imóvel/outros).
  // Valor no formato `${kind}:${index}` que o DocumentCard codifica/decodifica.
  // Mesmo builder da etapa 0 do formulário (paridade com o lado do cliente):
  // antes daqui o admin só via vendedor/comprador/imóvel/outro e não conseguia
  // mover um doc pro cônjuge, procurador ou representante de uma parte.
  const assignmentOptions: SelectGroup[] = buildAssignmentOptions(
    { vendedores, compradores, imoveis },
    kinds.flatMap((k) => groups[k])
  );

  /**
   * PATCH só grava o `assignment` — reatribuir aqui NÃO limpa o slot antigo do
   * `dataJson` (diferente da etapa 0, que roda o D7). É deliberado: no admin o
   * autofill é ação explícita ("Aplicar"), e mexer no dataJson por baixo de uma
   * reatribuição visual apagaria dado que o operador pode ter corrigido à mão.
   */
  const handleReassign = async (id: string, value: string) => {
    const [kind, idxStr] = value.split(":");
    const index = Number.parseInt(idxStr, 10) || 0;
    const res = await fetch(`/api/deals/${dealId}/attachments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignment: { kind, index } }),
    });
    if (res.ok) {
      toast.success("Documento movido");
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error || "Erro ao mover documento");
    }
  };

  // Documentos vindos do formulário existem como FormAttachment. Para mover ou
  // enviar para assinatura, primeiro os copiamos (idempotente) para um
  // DealAttachment — daí toda a maquinaria existente (PATCH assignment, diálogo
  // de assinatura) passa a funcionar. Retorna o DealAttachment criado/existente.
  const promoteFormAttachment = async (
    formAttId: string
  ): Promise<{
    id: string;
    filename: string;
    mime: string;
    category: string | null;
  } | null> => {
    setPromotingIds((prev) => new Set(prev).add(formAttId));
    try {
      const res = await fetch(`/api/deals/${dealId}/attachments/from-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formAttachmentId: formAttId }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.error || "Falha ao trazer documento do formulário");
        return null;
      }
      return d.attachment as {
        id: string;
        filename: string;
        mime: string;
        category: string | null;
      };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro de rede");
      return null;
    } finally {
      setPromotingIds((prev) => {
        const n = new Set(prev);
        n.delete(formAttId);
        return n;
      });
    }
  };

  // "Mover para…" num doc do formulário: copia → DealAttachment, depois reusa o
  // handleReassign (PATCH assignment + router.refresh).
  const handleReassignFormDoc = async (formAttId: string, value: string) => {
    const att = await promoteFormAttachment(formAttId);
    if (att) await handleReassign(att.id, value);
  };

  // "Enviar para assinatura" num doc do formulário: copia → DealAttachment e
  // abre o diálogo já com o novo anexo disponível (extraSignable cobre o gap
  // até o router.refresh).
  const handleSendFormDoc = async (formAttId: string) => {
    const att = await promoteFormAttachment(formAttId);
    if (!att) return;
    setExtraSignable((prev) =>
      prev.some((p) => p.id === att.id) ? prev : [...prev, att]
    );
    setSignAttachmentId(att.id);
  };

  // OCR seletivo sob demanda num DealAttachment manual. Persiste em
  // extractedData.fields; router.refresh re-renderiza com os campos.
  const handleExtract = async (id: string) => {
    setExtractingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/deals/${dealId}/attachments/${id}/extract`, {
        method: "POST",
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.error || "Falha na leitura por IA");
        return;
      }
      toast.success("Documento lido pela IA");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setExtractingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  // Aplica os campos extraídos no negócio (autofill). Usa o assignment já
  // persistido no anexo (o usuário ajusta via "Mover para…" antes).
  const handleApplyFields = async (id: string) => {
    try {
      const res = await fetch(`/api/deals/${dealId}/attachments/${id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.error || "Falha ao aplicar aos campos");
        return;
      }
      toast.success(`${d?.filled ?? 0} campo(s) preenchido(s) no negócio`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro de rede");
    }
  };

  // reassignable: mostra o seletor "Mover para…". Em DealAttachment usa a rota
  // PATCH direta; em FormAttachment (doc do formulário) copia sob demanda antes.
  // Certidões ficam de fora (auto-classificadas pelo executor).
  const renderDocCard = (doc: DocumentCardData, reassignable = false) => {
    const isDealAttachment = dealAttachmentIds.has(doc.id);
    // Docs do formulário ainda não copiados: fileUrl aponta pra /api/forms/.
    const isFormAttachment = doc.fileUrl.includes("/api/forms/");
    const canRemove = isDealAttachment && !!onRequestRemoveDealAttachment;
    const canReassign = reassignable && isDealAttachment;
    // OCR/aplicar só pra docs manuais do deal (não certidões/Infosimples).
    const isOcrEligible = ocrEligibleIds.has(doc.id);
    // Mover/assinar valem pra DealAttachment manual E pra docs do formulário
    // (estes via cópia sob demanda → DealAttachment).
    const showMove = canReassign || (reassignable && isFormAttachment);
    const onMove = canReassign
      ? handleReassign
      : reassignable && isFormAttachment
        ? handleReassignFormDoc
        : undefined;
    const onSend = !canSendEnvelope
      ? undefined
      : isOcrEligible
        ? (id: string) => setSignAttachmentId(id)
        : isFormAttachment
          ? handleSendFormDoc
          : undefined;
    const isSigned = !!doc.category && SIGNED_CATS.has(doc.category);
    const card = (
      <DocumentCard
        key={doc.id}
        doc={doc}
        assignmentOptions={showMove ? assignmentOptions : []}
        onAssignmentChange={onMove}
        // Form attachments não têm X aqui (removidos no form), mas precisam de
        // readOnly=false pra exibir mover/assinar.
        readOnly={!(canRemove || isFormAttachment)}
        onRemove={canRemove ? (id) => onRequestRemoveDealAttachment(id) : undefined}
        onExtract={isOcrEligible ? handleExtract : undefined}
        onRetry={isOcrEligible ? handleExtract : undefined}
        onApply={isOcrEligible ? handleApplyFields : undefined}
        onSendToSignature={onSend}
        busy={promotingIds.has(doc.id)}
      />
    );
    if (!isSigned) return card;
    // Documento assinado: destaque verde + selo pra identificação imediata.
    return (
      <div
        key={doc.id}
        className="relative rounded-lg ring-2 ring-emerald-500/60 bg-emerald-50/40"
      >
        <span className="absolute -top-2 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white shadow-xs">
          <CheckCircle2 className="h-3 w-3" />
          Assinado
        </span>
        {card}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <AddDocumentsCard dealId={dealId} onUploaded={() => router.refresh()} />

      {!hasAnyContent && (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Nenhum documento ainda. Suba arquivos acima (qualquer tipo) para
          armazenar, ler com a IA ou enviar para assinatura.
        </p>
      )}

      {/* Certidões: bloco próprio, subdividido por parte/imóvel (+ Gerais). */}
      {certidaoSubGroups.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Certidões{" "}
              <span className="text-muted-foreground font-normal">
                ({certidaoTotal})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {certidaoSubGroups.map((sub) => (
              <div key={sub.key} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {sub.label}{" "}
                  <span className="font-normal">({sub.rows.length})</span>
                </p>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {sub.rows.map((doc) => renderDocCard(doc))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {kinds.map((kind) => {
        const items = groups[kind];
        if (items.length === 0) return null;
        return (
          <Card key={kind}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {KIND_LABELS[kind]}{" "}
                <span className="text-muted-foreground font-normal">
                  ({items.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((doc) => renderDocCard(doc, true))}
            </CardContent>
          </Card>
        );
      })}

      <DocumentosRemovidos dealId={dealId} attachmentCount={fallbackAttachments.length} />

      <SendAttachmentEnvelopeDialog
        open={!!signAttachmentId}
        onOpenChange={(o) => {
          if (!o) setSignAttachmentId(null);
        }}
        dealId={dealId}
        attachments={[
          ...signablePdfs,
          ...extraSignable.filter(
            (e) => !signablePdfs.some((s) => s.id === e.id)
          ),
        ]}
        partySuggestions={partySuggestions}
        preselectAttachmentId={signAttachmentId ?? undefined}
        onSent={() => {
          setSignAttachmentId(null);
          setExtraSignable([]);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * "Documentos removidos" — a outra metade do arquivo de exclusões.
 *
 * Excluir documento deixou de ser destrutivo: a linha vai pra
 * `DeletedAttachment` e o blob é preservado. Sem esta lista o corretor não teria
 * como saber que dá pra desfazer, e o arquivo viraria só um registro de
 * auditoria invisível.
 *
 * Fica recolhido e só aparece quando há algo removido — a pasta é do trabalho
 * do dia, não do histórico.
 */
/**
 * Data/hora determinística, sem `Intl`. `toLocaleString` renderiza diferente no
 * servidor e no cliente (fuso/ICU) e quebra a hidratação — React #418/#423, que
 * derruba a subárvore inteira. Este componente aparece justamente na aba onde
 * isso foi observado em produção.
 */
function formatDeletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function DocumentosRemovidos({
  dealId,
  attachmentCount,
}: {
  dealId: string;
  /**
   * Muda quando um documento é removido (ou restaurado). Entra nas deps do
   * efeito porque `router.refresh()` re-renderiza o server component mas NÃO
   * remonta este client component nem re-dispara o efeito — sem isto, o
   * documento recém-excluído só aparecia aqui depois de recarregar a página.
   */
  attachmentCount: number;
}) {
  interface RemovedItem {
    id: string;
    filename: string;
    category: string | null;
    origin: string;
    deletedVia: string;
    deletedAt: string;
    restored: boolean;
  }
  const router = useRouter();
  const [items, setItems] = useState<RemovedItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/attachments/restore`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (!cancelled) setItems(Array.isArray(d?.items) ? d.items : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId, attachmentCount]);

  if (!items || items.length === 0) return null;

  const handleRestore = async (archivedId: string) => {
    setRestoring(archivedId);
    try {
      const res = await fetch(`/api/deals/${dealId}/attachments/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivedId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Falha ao restaurar documento.");
        return;
      }
      toast.success("Documento restaurado.");
      setItems((prev) =>
        prev
          ? prev.map((i) => (i.id === archivedId ? { ...i, restored: true } : i))
          : prev
      );
      router.refresh();
    } catch {
      toast.error("Erro ao restaurar documento.");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <CardTitle className="text-sm text-muted-foreground">
            Documentos removidos{" "}
            <span className="font-normal">({items.length})</span>
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {open ? "Ocultar" : "Ver"}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Nada é apagado de vez: o arquivo continua guardado e pode voltar pra
            pasta.
          </p>
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{item.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDeletedAt(item.deletedAt)}
                  {item.origin === "form" ? " · do formulário" : ""}
                </p>
              </div>
              {item.restored ? (
                <span className="shrink-0 text-xs text-green-700 dark:text-green-400">
                  restaurado
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-xs"
                  disabled={restoring === item.id}
                  onClick={() => handleRestore(item.id)}
                >
                  <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                  {restoring === item.id ? "Restaurando..." : "Restaurar"}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
