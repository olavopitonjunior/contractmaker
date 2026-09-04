"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Briefcase, ChevronLeft, Copy, FileText, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { proposalStatusView, proposalEventLabel } from "@/lib/proposals/status-view";
import {
  EDITABLE_STATUSES,
  AWAITING_DECISION_STATUSES,
  TERMINAL_STATUSES,
  PUBLIC_LINK_BLOCKED_STATUSES,
} from "@/lib/proposals/status-sets";
import { RenameProposalDialog } from "./RenameProposalDialog";
import { dealPathForKind } from "@/lib/proposals/use-convert-proposal";
import { useProposalPolling } from "@/hooks/useProposalPolling";
import { ProposalProgressTimeline } from "./ProposalProgressTimeline";
import { ProposalAssigneeControl } from "./ProposalAssigneeControl";
import { ProposalActionBar } from "./ProposalActionBar";
import { ProposalDecisionCard } from "./ProposalDecisionCard";
import type { PlanVendedor } from "./EnviarProprietarioDialog";
import { ProposalDocumentCard } from "./ProposalDocumentCard";
import { ProposalAttachmentUpload } from "./ProposalAttachmentUpload";
import { ProposalDocumentsSection, type ProposalDocumentRow } from "./ProposalDocumentsSection";
import { ProposalSignaturesSection } from "./ProposalSignaturesSection";
import type { ProposalPermissions } from "./ProposalRowActions";
import type { ProposalDetails, ProposalPartyLine } from "@/lib/proposals/summarize";

// Rótulo/cor por signatário. Duas fontes de vocabulário DISJUNTAS:
//  - EnvelopeSigner.status (polling/envelope): pending/notified/viewed/signed/
//    refused/email_failed/removed
//  - ProposalSigner.acceptanceStatus (Aceite/WhatsApp, sem envelope): completed/
//    sent/expired/canceled (+ refused, que coincide)
// Ambos mapeados aqui pra o Aceite não renderizar o token cru em inglês.
const SIGNER_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  notified: "Notificado",
  viewed: "Visualizou",
  signed: "Assinou",
  refused: "Recusou",
  email_failed: "Falha no e-mail",
  removed: "Removido",
  // Vocabulário do Aceite (acceptanceStatus):
  completed: "Assinou",
  sent: "Aguardando",
  expired: "Expirou",
  canceled: "Cancelado",
};

/**
 * Tudo que dependeria de locale ou do relógio já chega FORMATADO do server
 * component (`.../propostas/[id]/page.tsx`): datas, prazo e valor são strings.
 *
 * Não voltar a formatar aqui. `toLocale*` resolve o padrão de data no ICU do
 * runtime, e o ICU do Node da Vercel não é o do browser do usuário — a mesma
 * data saía "28/07/2026 20:23" no HTML do servidor e "28/07/2026, 20:23" na
 * hidratação. E o prazo relativo ("faltam 5d") deriva de `Date.now()`, que muda
 * entre o SSR e a hidratação. Qualquer um dos dois é hydration mismatch: React
 * #418 e, quando escala, #423 (a raiz inteira re-renderiza no client e o card
 * "Documento" fica em branco). Ver lib/format/datetime.ts.
 */
interface Proposal {
  id: string;
  /** "PROP-2026-0042". Null só em proposta anterior ao backfill do código. */
  code: string | null;
  title: string;
  status: string;
  kind: string;
  instrument: string;
  /**
   * Há envelope ClickSign (qualquer status, inclusive `failed`). Quando há, a
   * seção de assinaturas assume o lugar da lista simples de signatários — senão
   * os mesmos nomes apareceriam duas vezes na mesma tela.
   */
  hasEnvelopes: boolean;
  createdAtLabel: string;
  sentAtLabel: string;
  /** `sentAt` CRU (ISO) — pergunta da EXCLUSÃO. Ver `isFalhaEnvioAlreadyDelivered`. */
  sentAt: string | null;
  /** Último de `SEND_OUTCOME_EVENTS`, ou `null` — pergunta do RÓTULO. */
  lastSendOutcome: string | null;
  deliveredAtLabel: string;
  firstViewedAtLabel: string;
  viewCount: number;
  lastReminderAtLabel: string;
  reminderCount: number;
  validUntilLabel: string;
  prazo: { label: string; danger: boolean };
  /** ISO do updatedAt do servidor — desempata prop fresco × polling parado. */
  updatedAtIso: string;
  convertedDealId: string | null;
  /** Já recriada — o ActionBar esconde "Recriar" e o card mostra o link. */
  supersededById: string | null;
  /**
   * Thread de recriação: de onde veio / quem a substituiu. `id: null` = a outra
   * ponta está fora do escopo do visitante — mostra o fato, sem link nem code.
   */
  thread: {
    parent: { id: string | null; label: string } | null;
    supersededBy: { id: string | null; label: string } | null;
  };
  dossierUrl: string | null;
  resumo: { proponente: string | null; imovel: string | null; valorLabel: string | null };
  /** Partes completas + condições/comissão/corretor, tudo formatado no server. */
  detalhes: ProposalDetails;
  responsible: { name: string; isNonUser: boolean; image: string | null };
  responsibleUserId: string | null;
  responsibleName: string | null;
  creatorName: string | null;
  /**
   * Corretores parceiros (acompanham por e-mail). `notifica` já vem resolvido
   * do registry no server: e-mail ligado, sem opt-out e com endereço.
   */
  parceiros?: Array<{
    nome: string;
    creci: string | null;
    phone: string | null;
    email: string | null;
    notifica: boolean;
  }>;
  /** Nome do modelo (ContractTemplate) usado no render, ou null. */
  templateName: string | null;
  /** Link público /p/[token] pronto (host resolvido no server). */
  publicUrl: string | null;
  /** Prazo próprio da 2ª via (proprietário), formatado; null quando não há. */
  vendedorDeadlineLabel: string | null;
  /** Custo reservado do envio, formatado; null quando 0. */
  reservedCostLabel: string | null;
  comissaoIncluida: boolean;
  /** `hiddenPaths` esconde a comissão na via do proprietário. */
  comissaoOculta: boolean;
  recusa: {
    porLabel: string | null;
    emLabel: string;
    reason: string | null;
    counterLabel: string | null;
  } | null;
}

export function ProposalDetailClient({
  proposal,
  signers,
  events,
  attachments,
  members,
  creditFeatureEnabled = false,
  partiesSnapshot,
  permissions,
  sentSnapshotHtml,
  planVendedores = [],
  vendedorCostLabel = null,
  vendedorIncluded = true,
  vendedorSkipped = false,
}: {
  proposal: Proposal;
  signers: {
    id: string;
    name: string;
    role: string;
    channel: string;
    status: string;
    /** "1ª via" | "2ª via" | "Pendente" — de qual via/estado a linha vem. */
    viaLabel?: string | null;
  }[];
  events: {
    id: string;
    eventName: string;
    receivedAtLabel: string;
    /** Razão extraída do payload (falhas da 2ª via, preflight etc.). */
    detail?: string | null;
  }[];
  attachments: ProposalDocumentRow[];
  members: { id: string; name: string }[];
  /** Feature `locacao.credito` ligada (locação): seção de documentos por parte. */
  creditFeatureEnabled?: boolean;
  partiesSnapshot?: {
    locadores: Array<Record<string, unknown>>;
    locatarios: Array<Record<string, unknown>>;
    garantia?: { tipo?: string; fiador?: Record<string, unknown> };
  };
  permissions: ProposalPermissions;
  /** Documento congelado no envio (null enquanto a proposta não saiu). */
  sentSnapshotHtml: string | null;
  /** Linhas de vendedor do PLANO (parada de decisão) + custo da 2ª via. */
  planVendedores?: PlanVendedor[];
  vendedorCostLabel?: string | null;
  /** Há vendedor na jornada? (omite o nó Proprietário da timeline) */
  vendedorIncluded?: boolean;
  /** Concluída SEM enviar a via do proprietário (caminho B da decisão). */
  vendedorSkipped?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<null | {
    id: string;
    filename: string;
  }>(null);
  const [contactEdit, setContactEdit] = useState<null | {
    signerId: string;
    name: string;
    email: string;
    phone: string;
  }>(null);

  // Tempo real: pulla o status enquanto a proposta está viva; refresh do server
  // component quando muda (webhook → DB → aqui em ~3.5s).
  const isLive = ![
    "convertida",
    "cancelada",
    "expirada",
    "recusada_proponente",
    "recusada_vendedor",
    "rascunho",
    "falha_envio",
  ].includes(proposal.status);
  const { data: live } = useProposalPolling(proposal.id, {
    enabled: isLive,
    onStatusChange: () => router.refresh(),
  });
  // O payload do polling pode estar PARADO (active=false — terminais e a parada
  // de decisão ficam fora do LIVE_POLL de propósito). Depois de uma ação na
  // própria tela (concluir/enviar → router.refresh()), o prop do servidor chega
  // mais novo que o retrato congelado do poller — sem este desempate por
  // updatedAt, o card de decisão continuava na tela após "Concluir sem enviar".
  const liveStatus =
    live && Date.parse(live.updatedAt) > Date.parse(proposal.updatedAtIso)
      ? live.status
      : proposal.status;
  // Mesma regra de frescor do status, e NÃO um ?? simples: os dois têm de vir
  // do MESMO snapshot. Status ao vivo com sentAt congelado da carga reabria uma
  // janela do bug do Excluir (status já é falha_envio, sentAt ainda null).
  const liveSentAt =
    live && Date.parse(live.updatedAt) > Date.parse(proposal.updatedAtIso)
      ? live.sentAt
      : proposal.sentAt;
  const sv = proposalStatusView(liveStatus, proposal.lastSendOutcome);
  const pz = proposal.prazo;
  // Derivado do status AO VIVO (não do prop do servidor): se a proposta for
  // enviada em outra aba, o botão de editar some junto com o preview — mesmo
  // conjunto que o PATCH e o /preview aceitam no servidor. `write` porque o
  // PATCH também exige permissão de escrita: sem isso o botão levava um papel
  // de leitura a um formulário que só falharia no salvar.
  const canEdit = permissions.write && EDITABLE_STATUSES.has(liveStatus);
  // Renomear vale além de EDITABLE_STATUSES: título é rótulo interno, não o
  // documento congelado. Mesmo corte da rota PATCH .../title — terminais fora,
  // e permissão de escrita exigida (VIEW_ALL sozinho não basta).
  const canRename = permissions.write && !TERMINAL_STATUSES.has(liveStatus);
  const isAceite = proposal.instrument === "aceite";
  // Mesma permissão que a rota /attachments/finalize exige (PROPOSAL_SEND):
  // quem envia a proposta pra assinatura é quem cuida da documentação dela.
  const canAttach = permissions.send;
  const detalhes = proposal.detalhes;
  // Default VENDA (não locação) — o mesmo do dispatch do servidor em
  // summarizeProposalDetails; divergir os dois rotularia a lista errada num
  // kind fora do domínio (backfill/futuro schemaType).
  const sellerBase = proposal.kind === "locacao" ? "Locador" : "Vendedor";

  async function copyPublicLink() {
    if (!proposal.publicUrl) return;
    try {
      await navigator.clipboard.writeText(proposal.publicUrl);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  }

  // Ações por-signatário (no EnvelopeSigner do envelope em curso). "contact" é
  // alimentada pelo diálogo abaixo — dois `window.prompt` em sequência não davam
  // contexto (qual
  // signatário?), não validavam nada e um Esc no 2º já tinha coletado o 1º.
  /**
   * Exclusão de documento da proposta. A confirmação é um Dialog, não
   * `window.confirm`: o modal nativo trava a automação de navegador (e o
   * `signerAction` abaixo ainda usa `confirm`, o que é dívida conhecida).
   * A rota arquiva a linha e preserva o blob, então isto é reversível — o
   * texto do diálogo diz isso pra não assustar mais do que deve.
   */
  async function deleteAttachment(attachmentId: string, filename: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/proposals/${proposal.id}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success(`"${filename}" removido dos documentos.`);
      setDeleteTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    } finally {
      setBusy(false);
    }
  }

  async function signerAction(
    signerId: string,
    kind: "resend" | "remove" | "contact",
    patchBody?: Record<string, string>
  ) {
    let url = `/api/proposals/${proposal.id}/signers/${signerId}`;
    let method = "PATCH";
    let body: string | undefined;
    if (kind === "resend") {
      url += "/resend";
      method = "POST";
    } else if (kind === "remove") {
      if (!window.confirm("Remover este signatário da proposta?")) return;
      method = "DELETE";
    } else {
      if (!patchBody || Object.keys(patchBody).length === 0) return;
      body = JSON.stringify(patchBody);
    }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success(
        kind === "resend"
          ? "Notificação reenviada"
          : kind === "remove"
            ? "Signatário removido"
            : "Contato atualizado"
      );
      setContactEdit(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na ação");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/pipeline/propostas"
            className="inline-flex items-center text-sm text-muted-foreground hover:underline"
          >
            <ChevronLeft className="h-4 w-4" /> Propostas
          </Link>
          <div className="mt-1 flex items-center gap-1.5">
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight">
              {proposal.title}
            </h1>
            {canRename && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                title="Renomear proposta"
                aria-label="Renomear proposta"
                onClick={() => setRenameOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {proposal.code && (
            <div className="font-mono text-xs text-muted-foreground">{proposal.code}</div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={`${sv.className} px-2.5 py-0.5`}>
              {sv.label}
            </Badge>
            {/* "De quem é a bola" só quando acrescenta algo — em
                aguardando_vendedor label e turn são a MESMA frase e o header
                ecoava "Com o proprietário · Com o proprietário". */}
            {sv.turn !== sv.label && (
              <span className="text-muted-foreground">· {sv.turn}</span>
            )}
            <span className="text-muted-foreground">
              · {proposal.kind === "venda" ? "Venda" : "Locação"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
            <Button variant="outline" asChild>
              <Link href={`/pipeline/propostas/${proposal.id}/editar`}>
                <Pencil className="mr-1.5 h-4 w-4" /> Editar proposta
              </Link>
            </Button>
          )}
          {proposal.convertedDealId && (
            <Button variant="outline" asChild>
              <Link href={dealPathForKind(proposal.kind, proposal.convertedDealId)}>
                <Briefcase className="mr-1.5 h-4 w-4" /> Ver negócio
              </Link>
            </Button>
          )}
          <ProposalActionBar
            proposal={{
              id: proposal.id,
              status: liveStatus,
              kind: proposal.kind,
              instrument: proposal.instrument,
              convertedDealId: proposal.convertedDealId,
              sentAt: liveSentAt,
              supersededById: proposal.supersededById,
            }}
            permissions={permissions}
            kind={proposal.kind}
            vendedores={planVendedores}
            custoLabel={vendedorCostLabel}
          />
        </div>
      </div>

      {/* Card de decisão — o proponente assinou, a bola é do corretor */}
      {AWAITING_DECISION_STATUSES.has(liveStatus) && permissions.send && (
        <ProposalDecisionCard
          proposalId={proposal.id}
          kind={proposal.kind}
          vendedores={planVendedores}
          custoLabel={vendedorCostLabel}
        />
      )}

      {/* Linha do tempo */}
      <Card className="p-4">
        <ProposalProgressTimeline
          status={liveStatus}
          vendedorIncluded={vendedorIncluded}
          vendedorSkipped={vendedorSkipped}
        />
      </Card>

      {/* Grid 2×2 — os quatro cards informativos: Resumo & partes · Condições
          do negócio · Responsável & origem · Datas & link. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Resumo</h2>
          <Row label="Imóvel" value={proposal.resumo.imovel ?? "—"} />
          <Row label="Valor" value={proposal.resumo.valorLabel ?? "—"} />
          <Row
            label="Instrumento"
            value={isAceite ? "Aceite via WhatsApp" : "Assinatura (envelope)"}
          />
          <PartyList
            title={detalhes.proponentes.length > 1 ? "Proponentes" : "Proponente"}
            parties={detalhes.proponentes}
          />
          <PartyList
            title={
              detalhes.vendedores.length > 1 ? `${sellerBase}es` : sellerBase
            }
            parties={detalhes.vendedores}
          />
          {detalhes.observacoes && (
            <p
              className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground"
              title={detalhes.observacoes}
            >
              {detalhes.observacoes}
            </p>
          )}
          {proposal.dossierUrl && (
            <a
              href={proposal.dossierUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <FileText className="h-4 w-4" />{" "}
              {/* `dossierUrl` é o mesmo campo nos dois modos, mas o que ele
                  guarda não é a mesma coisa: no envelope é o dossiê com os PDFs
                  ASSINADOS; no Aceite é um comprovante que nós montamos. Chamar
                  os dois de "Documento final" fazia o Aceite parecer assinatura. */}
              {isAceite ? "Comprovante de Aceite (PDF)" : "Documento final (PDF)"}
            </a>
          )}
          {isAceite && (
            <p className="mt-2 border-l-2 border-amber-500 pl-3 text-xs text-muted-foreground">
              O Aceite via WhatsApp <strong>não é assinatura em documento</strong>: o
              cliente confirmou por texto + link. O Registro do Aceite oficial, com as
              provas de identidade e as mensagens trocadas, é emitido pela ClickSign
              (Aceites → Via WhatsApp) — baixe lá e anexe em Documentos.
            </p>
          )}
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Condições do negócio</h2>
          {detalhes.condicoes.map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
          {/* `comissaoOculta` força o bloco mesmo sem linhas: o aviso de que a
              via do proprietário omite a comissão não pode depender de haver
              percentual/valor preenchidos. */}
          {(detalhes.comissao.length > 0 || proposal.comissaoOculta) && (
            <div className="space-y-2 border-t pt-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Comissão</span>
                {/* Sem `comissaoIncluida` o render tira a comissão das DUAS
                    vias — os números abaixo existem no dataJson mas não no
                    documento, e sem o badge o card mentiria por omissão. */}
                {proposal.comissaoOculta ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    oculta na via do proprietário
                  </Badge>
                ) : proposal.comissaoIncluida ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    incluída na proposta
                  </Badge>
                ) : (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    fora do documento
                  </Badge>
                )}
              </div>
              {detalhes.comissao.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
            </div>
          )}
          {detalhes.corretorLabel && (
            <Row label="Corretor" value={detalhes.corretorLabel} />
          )}
          {detalhes.condicoes.length === 0 &&
            detalhes.comissao.length === 0 &&
            !proposal.comissaoOculta &&
            !detalhes.corretorLabel && (
              <p className="text-sm text-muted-foreground">
                Sem condições informadas ainda.
              </p>
            )}
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Responsável</h2>
          <ProposalAssigneeControl
            proposalId={proposal.id}
            responsible={proposal.responsible}
            responsibleUserId={proposal.responsibleUserId}
            members={members}
            canAssign={permissions.assign}
          />
          <div className="space-y-2 border-t pt-3">
            <Row label="Criada por" value={proposal.creatorName ?? "—"} />
            <Row label="Modelo" value={proposal.templateName ?? "—"} />
            <Row label="Criada" value={proposal.createdAtLabel} />
            <ThreadRow label="Recriação de" target={proposal.thread.parent} />
            <ThreadRow label="Recriada como" target={proposal.thread.supersededBy} />
          </div>
          {(proposal.parceiros ?? []).length > 0 && (
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Corretores parceiros
              </p>
              <ul className="space-y-1 text-sm">
                {(proposal.parceiros ?? []).map((p, i) => (
                  <li key={`${p.nome}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{p.nome}</span>
                    {p.creci && <span className="text-muted-foreground">CRECI {p.creci}</span>}
                    {p.phone && <span className="text-muted-foreground">{p.phone}</span>}
                    {p.email && <span className="text-muted-foreground">{p.email}</span>}
                    <span
                      className={
                        p.notifica ? "text-xs text-emerald-700" : "text-xs text-muted-foreground"
                      }
                      title={
                        p.notifica
                          ? "Recebe e-mail nos marcos da proposta"
                          : "Sem e-mail ou avisos desligados no cadastro de corretores"
                      }
                    >
                      {p.notifica ? "· avisa por e-mail" : "· sem aviso"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Datas e link</h2>
          <Row label="Enviada" value={proposal.sentAtLabel} />
          <Row label="Entregue" value={proposal.deliveredAtLabel} />
          <Row
            label="Visualizada"
            value={
              proposal.viewCount > 1
                ? `${proposal.firstViewedAtLabel} (${proposal.viewCount}×)`
                : proposal.firstViewedAtLabel
            }
          />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Validade</span>
            <span className="font-medium">
              {proposal.validUntilLabel}{" "}
              <span className={pz.danger ? "text-destructive" : "text-muted-foreground"}>
                ({pz.label})
              </span>
            </span>
          </div>
          {proposal.reminderCount > 0 && (
            <Row
              label="Último lembrete"
              value={`${proposal.lastReminderAtLabel} (${proposal.reminderCount}×)`}
            />
          )}
          {proposal.vendedorDeadlineLabel && (
            <Row label="Validade da 2ª via" value={proposal.vendedorDeadlineLabel} />
          )}
          {proposal.reservedCostLabel && (
            <Row label="Custo do envio" value={proposal.reservedCostLabel} />
          )}
          {/* Mesmo gate do /p/[token] (404 nesses status): oferecer copiar um
              link que o cliente abriria em notFound() é pior que não mostrar. */}
          {proposal.publicUrl && !PUBLIC_LINK_BLOCKED_STATUSES.has(liveStatus) && (
            <div className="flex items-center gap-2 border-t pt-2 text-sm">
              <span className="shrink-0 text-muted-foreground">Link público</span>
              <span
                className="min-w-0 flex-1 truncate text-right font-mono text-xs"
                title={proposal.publicUrl}
              >
                {proposal.publicUrl}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                title="Copiar link público"
                aria-label="Copiar link público"
                onClick={() => void copyPublicLink()}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {proposal.recusa && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
              <p className="font-medium text-destructive">
                Recusada{proposal.recusa.porLabel ? ` ${proposal.recusa.porLabel}` : ""} em{" "}
                {proposal.recusa.emLabel}
              </p>
              {proposal.recusa.reason && (
                <p className="mt-0.5 text-muted-foreground">{proposal.recusa.reason}</p>
              )}
              {proposal.recusa.counterLabel && (
                <p className="mt-0.5">
                  Contraproposta:{" "}
                  <span className="font-medium">{proposal.recusa.counterLabel}</span>
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Assinaturas simples (Aceite/rascunho, sem envelope) — abaixo do grid;
          com envelope a seção completa assume. `md:max-w-xl` porque as linhas
          rótulo/valor (justify-between) num card full-width abririam um vão
          enorme no meio. */}
      {!proposal.hasEnvelopes && (
        <Card className="space-y-2 p-4 md:max-w-xl">
          <h2 className="font-medium">Assinaturas</h2>
          {(() => {
            // Enviada: EnvelopeSigner do polling (id + status → ações por-linha).
            // Antes do envio: ProposalSigner (sem ações).
            const rows =
              live && live.signers.length > 0
                ? live.signers
                    .filter((s) => s.status !== "removed")
                    .map((s) => ({ id: s.id, name: s.name, role: s.role ?? "", channel: s.channel, status: s.status, sent: true, viaLabel: null as string | null }))
                : signers.map((s) => ({ id: s.id, name: s.name, role: s.role, channel: s.channel, status: s.status, sent: false, viaLabel: s.viaLabel ?? null }));
            if (rows.length === 0) {
              return <p className="text-sm text-muted-foreground">Nenhum signatário definido ainda.</p>;
            }
            return (
              <ul className="space-y-2 text-sm">
                {rows.map((s) => {
                  const badge = s.status ? SIGNER_STATUS_LABEL[s.status] ?? s.status : null;
                  const badgeCls =
                    s.status === "signed" || s.status === "completed"
                      ? "text-success"
                      : s.status === "refused" || s.status === "email_failed"
                        ? "text-destructive"
                        : s.status === "viewed"
                          ? "text-info"
                          : s.status === "sent"
                            ? "text-info"
                            : "text-muted-foreground";
                  // Só oferece Reenviar/Editar/Remover enquanto o desfecho está EM
                  // ABERTO. Exclui os terminais de ambos os vocabulários (envelope +
                  // aceite): assinou/recusou/expirou/cancelou/removido/falhou.
                  const actionable =
                    s.sent &&
                    ![
                      "signed",
                      "completed",
                      "removed",
                      "refused",
                      "expired",
                      "canceled",
                      "email_failed",
                    ].includes(s.status);
                  return (
                    <li key={s.id} className="space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="truncate">
                          {s.name} <span className="text-muted-foreground">· {s.role}</span>
                          {s.viaLabel ? (
                            <span className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">
                              {s.viaLabel}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{s.channel}</span>
                          {badge && <span className={badgeCls}>· {badge}</span>}
                        </span>
                      </div>
                      {actionable && permissions.resend && (
                        <div className="flex gap-3 text-xs">
                          <button className="text-primary hover:underline" onClick={() => signerAction(s.id, "resend")} disabled={busy}>
                            Reenviar
                          </button>
                          <button
                            className="text-primary hover:underline"
                            onClick={() =>
                              setContactEdit({
                                signerId: s.id,
                                name: s.name,
                                email: "",
                                phone: "",
                              })
                            }
                            disabled={busy}
                          >
                            Editar contato
                          </button>
                          <button className="text-destructive hover:underline" onClick={() => signerAction(s.id, "remove")} disabled={busy}>
                            Remover
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </Card>
      )}

      {/* Gestão de assinaturas (envelope ClickSign) — mesma UI dos contratos.
          Só rende quando há envelope; no Aceite via WhatsApp não existe um. */}
      {proposal.hasEnvelopes && (
        <ProposalSignaturesSection
          proposalId={proposal.id}
          canSync={permissions.send}
          refreshKey={live?.updatedAt ?? ""}
        />
      )}

      {/* Documento — preview antes do envio, snapshot congelado depois */}
      <ProposalDocumentCard
        proposalId={proposal.id}
        editable={canEdit}
        snapshotHtml={sentSnapshotHtml}
      />

      {/* Documentos por parte (locação com análise de crédito) */}
      {creditFeatureEnabled && partiesSnapshot && (
        <ProposalDocumentsSection
          proposalId={proposal.id}
          attachments={attachments}
          snapshot={partiesSnapshot}
          canEdit={canAttach}
          dossierUrl={proposal.dossierUrl}
          // O Registro do Aceite é documento do SISTEMA (categoria própria, sem
          // parte): a dropzone por parte não serve para ele. O botão continua
          // existindo com a feature ligada — o aviso lá em cima manda "anexar em
          // Documentos".
          headerAction={
            isAceite && canAttach ? (
              <ProposalAttachmentUpload
                proposalId={proposal.id}
                category="aceite_registro_clicksign"
                label="Anexar Registro do Aceite"
                onUploaded={() => router.refresh()}
              />
            ) : null
          }
        />
      )}

      {/* Documentos */}
      {!creditFeatureEnabled && (attachments.length > 0 || canAttach) && (
        <Card className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Documentos</h2>
            {canAttach && (
              <ProposalAttachmentUpload
                proposalId={proposal.id}
                category={isAceite ? "aceite_registro_clicksign" : "documento"}
                label={isAceite ? "Anexar Registro do Aceite" : "Anexar documento"}
                onUploaded={() => router.refresh()}
              />
            )}
          </div>
          {attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {attachments.map((a) => {
                // O documento final (dossiê/comprovante) é a peça probatória e
                // a rota recusa excluí-lo — não oferecer o botão evita um 409
                // previsível.
                const isFinal = !!proposal.dossierUrl && a.url === proposal.dossierUrl;
                return (
                  <li key={a.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {a.filename}
                      </a>
                      {a.category && <span className="text-muted-foreground"> · {a.category}</span>}
                    </span>
                    {canAttach && !isFinal && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDeleteTarget({ id: a.id, filename: a.filename })}
                        className="shrink-0 text-xs text-destructive hover:underline disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* Histórico — timeline vertical */}
      <Card className="p-4">
        <h2 className="mb-3 font-medium">Histórico</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-border pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm">{proposalEventLabel(e.eventName)}</span>
                  <span className="text-xs text-muted-foreground">{e.receivedAtLabel}</span>
                </div>
                {e.detail && (
                  <p className="text-xs text-muted-foreground">{e.detail}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Editar contato do signatário */}
      <Dialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir documento</DialogTitle>
            <DialogDescription>
              Remover <strong>{deleteTarget?.filename}</strong> dos documentos desta
              proposta? O arquivo é preservado no armazenamento e a exclusão fica
              registrada, então é possível restaurá-lo depois.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !deleteTarget}
              onClick={() => {
                if (deleteTarget) void deleteAttachment(deleteTarget.id, deleteTarget.filename);
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contactEdit != null} onOpenChange={(o) => !o && setContactEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar contato</DialogTitle>
            <DialogDescription>
              {contactEdit?.name} — preencha só o que quiser alterar. Campos em
              branco ficam como estão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="signer-email">E-mail</Label>
              <Input
                id="signer-email"
                type="email"
                value={contactEdit?.email ?? ""}
                onChange={(e) =>
                  setContactEdit((c) => (c ? { ...c, email: e.target.value } : c))
                }
                placeholder="novo@email.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="signer-phone">WhatsApp / telefone</Label>
              <Input
                id="signer-phone"
                inputMode="tel"
                value={contactEdit?.phone ?? ""}
                onChange={(e) =>
                  setContactEdit((c) => (c ? { ...c, phone: e.target.value } : c))
                }
                placeholder="(11) 98765-4321"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactEdit(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              disabled={
                busy ||
                !contactEdit ||
                (!contactEdit.email.trim() && !contactEdit.phone.trim())
              }
              onClick={() => {
                if (!contactEdit) return;
                const patch: Record<string, string> = {};
                if (contactEdit.email.trim()) patch.email = contactEdit.email.trim();
                if (contactEdit.phone.trim()) patch.phone = contactEdit.phone.trim();
                void signerAction(contactEdit.signerId, "contact", patch);
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RenameProposalDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        proposalId={proposal.id}
        currentTitle={proposal.title}
      />
    </div>
  );
}

/**
 * Uma ponta da thread de recriação. Sem `id` (outra ponta fora do escopo do
 * visitante) o fato aparece como texto — link levaria ao notFound() do guard
 * da própria página.
 */
function ThreadRow({
  label,
  target,
}: {
  label: string;
  target: { id: string | null; label: string } | null;
}) {
  if (!target) return null;
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {target.id ? (
        <Link
          href={`/pipeline/propostas/${target.id}`}
          className="min-w-0 truncate font-medium text-primary hover:underline"
          title={target.label}
        >
          {target.label}
        </Link>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">{target.label}</span>
      )}
    </div>
  );
}

function PartyList({
  title,
  parties,
}: {
  title: string;
  parties: ProposalPartyLine[];
}) {
  // Vazio renderiza "—" (não some): num rascunho recém-criado a linha ausente
  // esconderia justamente o que falta preencher.
  if (parties.length === 0) return <Row label={title} value="—" />;
  return (
    <div className="pt-1 text-sm">
      <span className="text-muted-foreground">{title}</span>
      <ul className="mt-1 space-y-1.5">
        {parties.map((p, i) => {
          const meta = [p.doc, p.contato].filter(Boolean).join(" · ");
          return (
            <li key={`${p.nome}-${i}`} className="leading-tight">
              <span className="font-medium">{p.nome}</span>
              {meta && (
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={meta}
                >
                  {meta}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  // `truncate` num flex child só funciona com min-w-0 (min-width:auto do flex
  // impede encolher); shrink-0 no label evita o valor longo espremer o rótulo.
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium" title={value}>
        {value}
      </span>
    </div>
  );
}
