import { prisma } from "@/lib/db/prisma";
import { SEND_OUTCOME_EVENTS } from "@/lib/proposals/status-sets";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { redirect, notFound } from "next/navigation";
import {
  getEffectivePermissions,
  canAccessProposal,
  can,
} from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { responsibleDisplay } from "@/lib/proposals/status-view";
import { clicksignRoleLabel } from "@/lib/clicksign/roles";
import { ProposalDetailClient } from "@/components/proposals/ProposalDetailClient";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { formatDateTimeBR } from "@/lib/format/datetime";
import { proposalDeadline } from "@/lib/proposals/deadline";
import { formatMoneyBR } from "@/lib/format/money";
import {
  summarizeProposalData,
  summarizeProposalDetails,
} from "@/lib/proposals/summarize";
import { proposalPublicLink } from "@/lib/proposals/public-link";
import { hidesComissao } from "@/lib/proposals/hidden-fields";
import { checkProposalReadiness } from "@/lib/proposals/clicksign-readiness";
import { plannedProposalCostCents } from "@/lib/proposals/cost";
import { getSignatureSettings } from "@/lib/clicksign/account";
import { readPartnerBrokerRows } from "@/lib/proposals/partner-brokers";
import { resolveDealBrokers } from "@/lib/notifications/deal-brokers";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { proposalPartiesSnapshot } from "@/lib/proposals/attachment-assignment";
import { applyProposalExtractions } from "@/lib/proposals/apply-extractions";
import { derivePretendentes, tipoImovelForSchema } from "@/lib/credit/pretendentes";
import { readCreditConsent } from "@/lib/credit/consent";

export const dynamic = "force-dynamic";

// Rótulo PT do papel de domínio do ProposalSigner (fallback Aceite, sem envelope).
const PLAN_ROLE_LABEL: Record<string, string> = {
  proponente: "Proponente",
  vendedor: "Vendedor",
  testemunha: "Testemunha",
  corretora: "Corretora",
};

export default async function PropostaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/pipeline");

  // Impersonation: sob "trocar de tenant", quem resolve membership/RBAC é o dono
  // do tenant, não o super_admin (ver lib/auth/impersonation.ts).
  const effUserId = await getEffectiveUserId(session.user.id);

  const proposal = await prisma.proposal.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true, name: true, image: true } },
      convertedDeal: { select: { managerUserId: true } },
      template: { select: { name: true } },
    },
  });
  if (!proposal || proposal.orgId !== org.id) notFound();

  const eff = await getEffectivePermissions(effUserId, org.id);
  if (
    !eff ||
    !canAccessProposal({
      effective: eff,
      ownerUserId: proposal.userId,
      responsibleUserId: proposal.responsibleUserId,
      // Sem isto o gerente do deal convertido abria a proposta pela API
      // (route-helpers passa o campo) mas levava notFound() na UI.
      convertedDealManagerUserId: proposal.convertedDeal?.managerUserId ?? null,
    })
  ) {
    notFound();
  }

  const [planSigners, lastOutcome, events, attachments, memberRows, envelopes, envelopeCount] =
    await Promise.all([
    prisma.proposalSigner.findMany({
      where: { proposalId: params.id },
      orderBy: { signingGroup: "asc" },
    }),
    // Consulta PRÓPRIA e não um `find` no array acima: aquele é `take: 50` e
    // uma proposta conversada (lembretes, syncs) empurraria o desfecho pra fora
    // da janela, fazendo o badge dizer "Falha no envio" num cancelamento.
    prisma.proposalEvent.findFirst({
      where: { proposalId: params.id, eventName: { in: [...SEND_OUTCOME_EVENTS] } },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: { eventName: true },
    }),
    prisma.proposalEvent.findMany({
      where: { proposalId: params.id },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    prisma.proposalAttachment.findMany({ where: { proposalId: params.id } }),
    prisma.orgMembership.findMany({
      where: { orgId: org.id },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.envelope.findMany({
      where: { proposalId: params.id, source: "proposal", status: { notIn: ["failed"] } },
      select: {
        via: true,
        signers: {
          select: { id: true, name: true, role: true, notifyChannel: true, status: true },
          orderBy: { signingGroup: "asc" },
        },
      },
      orderBy: { via: "asc" },
    }),
    // Conta TODOS os envelopes, inclusive `failed` (que a query acima exclui de
    // propósito, pra não sujar a lista de status por signatário). É o que decide
    // se a seção de assinaturas assume o lugar da lista simples — e um envelope
    // que falhou é justamente o que o corretor precisa ver, com o `lastError`.
    prisma.envelope.count({ where: { proposalId: params.id, source: "proposal" } }),
  ]);

  // Status REAL por signatário vem do EnvelopeSigner (onde vive sign/view/refuse),
  // não do ProposalSigner (plano). Sem isso o status por-linha sumia em propostas
  // terminais (polling off) — ex.: numa recusada não dava pra ver quem recusou.
  // Papel exibível: traduz a qualificação ClickSign (inglês) → PT via
  // clicksignRoleLabel (inclui testemunha; sourceKind colapsaria pra comprador).
  // A `via` NÃO é descartada (2026-08): o detalhe distingue a 1ª via
  // (proponente) da 2ª (proprietário) e marca as linhas do plano ainda sem
  // envelope como "Pendente".
  const VIA_LABEL: Record<string, string> = { completa: "1ª via", reduzida: "2ª via" };
  const envelopeSigners = envelopes.flatMap((e) =>
    e.signers.map((s) => ({
      id: s.id,
      name: s.name,
      role: clicksignRoleLabel(s.role) ?? "",
      channel: s.notifyChannel,
      status: s.status,
      viaLabel: VIA_LABEL[e.via ?? ""] ?? e.via ?? null,
    }))
  );
  // Vendedores do PLANO sem envelope da 2ª via (parada de decisão): aparecem
  // como via "Pendente" — antes sumiam da lista (só o ramo de envelope rendia).
  const hasReduzida = envelopes.some((e) => e.via === "reduzida");
  const pendingVendedores =
    envelopeSigners.length > 0 && !hasReduzida
      ? planSigners
          .filter((ps) => ps.role === "vendedor" && ps.included)
          .map((ps) => ({
            id: ps.id,
            name: ps.name,
            role: PLAN_ROLE_LABEL.vendedor,
            channel: ps.notifyChannel,
            status: "",
            viaLabel: "Pendente",
          }))
      : [];
  // Fallback pro ProposalSigner quando NÃO há envelope: propostas via Aceite
  // (WhatsApp) não criam Envelope, então o status por-signatário vive em
  // ProposalSigner.acceptanceStatus — sem isto o Aceite perdia a visibilidade de
  // quem aceitou/recusou. Também cobre rascunho (acceptanceStatus vazio → sem badge).
  const signers =
    envelopeSigners.length > 0
      ? [...envelopeSigners.filter((s) => s.status !== "removed"), ...pendingVendedores]
      : planSigners.map((s) => ({
          id: s.id,
          name: s.name,
          // Papel de domínio (proponente/vendedor/testemunha) rotulado em PT
          // capitalizado — mesmo formato do ramo de envelope (que traduz via
          // clicksignRoleLabel), pra não misturar "· proponente" com "· Vendedor".
          role: PLAN_ROLE_LABEL[s.role ?? ""] ?? s.role ?? "",
          channel: s.notifyChannel,
          status: s.acceptanceStatus ?? "",
          viaLabel: null as string | null,
        }));

  // Thread de recriação. `supersededById` é escalar puro (SEM relation no
  // schema — adicionar uma seria migration); o lookup é por findUnique. O
  // sentido inverso tem a relation `parentProposal`, mas o findUnique uniforme
  // evita mexer no include principal.
  const [parentRow, supersededRow] = await Promise.all([
    proposal.parentProposalId
      ? prisma.proposal.findUnique({
          where: { id: proposal.parentProposalId },
          select: {
            id: true,
            code: true,
            title: true,
            userId: true,
            responsibleUserId: true,
          },
        })
      : Promise.resolve(null),
    proposal.supersededById
      ? prisma.proposal.findUnique({
          where: { id: proposal.supersededById },
          select: {
            id: true,
            code: true,
            title: true,
            userId: true,
            responsibleUserId: true,
          },
        })
      : Promise.resolve(null),
  ]);

  /**
   * A outra ponta da thread passa pelo MESMO escopo da página. Fora dele, o
   * fato continua visível (explica o botão "Recriar" ausente) mas sem code,
   * título ou link — que levaria ao notFound() do guard acima e ainda vazaria
   * metadado de proposta que o visitante não pode abrir.
   */
  const threadRef = (
    row: { id: string; code: string | null; title: string; userId: string; responsibleUserId: string | null } | null
  ): { id: string | null; label: string } | null => {
    if (!row) return null;
    const visible = canAccessProposal({
      effective: eff,
      ownerUserId: row.userId,
      responsibleUserId: row.responsibleUserId,
    });
    return visible
      ? { id: row.id, label: row.code ?? row.title }
      : { id: null, label: "outra proposta" };
  };
  const parentRef = threadRef(parentRow);
  const supersededRef = threadRef(supersededRow);

  const d = (proposal.dataJson ?? {}) as Record<string, unknown>;
  // Mesmo resumo da listagem (lib compartilhada) — o local `summarize()` que
  // vivia aqui divergia dela (sem número do imóvel, sem trim).
  const resumo = summarizeProposalData(d, proposal.kind);
  // Documentos por parte + análise de crédito (locação) — só com a feature
  // `locacao.credito` ligada para a org; sem ela a seção antiga de Documentos
  // continua igual.
  const modulesView = await getOrgModules(org.id);
  const creditFeatureEnabled =
    proposal.kind === "locacao" && isFeatureEnabled(modulesView, FEATURE.LOCACAO_CREDITO);
  const partiesSnapshotFull = proposalPartiesSnapshot(d);
  const partiesSnapshot = {
    locadores: partiesSnapshotFull.locadores,
    locatarios: partiesSnapshotFull.locatarios,
    garantia: partiesSnapshotFull.garantia,
  };
  // Pretendentes da análise de crédito: derivados do dataJson JÁ com o OCR
  // dos documentos aplicado (só anexos prontos com atribuição humana) — o
  // mesmo dado que o convert vai gravar. Consentimento LGPD lido pela chave
  // canônica (aceita o legado).
  const pretendentes = creditFeatureEnabled
    ? derivePretendentes(applyProposalExtractions(d, attachments, proposal.kind).merged)
    : [];
  const creditConsent = creditFeatureEnabled ? readCreditConsent(proposal.complianceJson) : null;
  const tipoImovel = tipoImovelForSchema(proposal.schemaType);

  // Corretores parceiros: linhas do dataJson + "notifica?" resolvido no registry
  // (mesma regra do e-mail: notifyByEmail, sem opt-out, com endereço).
  const parceiroRows = readPartnerBrokerRows(d);
  const parceiroBrokers =
    parceiroRows.length > 0
      ? await resolveDealBrokers({ orgId: org.id, formDataJson: d, brokerIds: [] }).catch(
          () => []
        )
      : [];
  const notifyingIds = new Set(
    parceiroBrokers.filter((b) => b.notifyByEmail && !!b.email).map((b) => b.splitRecipientId)
  );
  const parceiros = parceiroRows.map((p) => ({
    nome: p.nome,
    creci: p.creci ?? null,
    phone: p.mobile_phone ?? null,
    email: p.email ?? null,
    notifica: !!p.splitRecipientId && notifyingIds.has(p.splitRecipientId),
  }));
  const resp = responsibleDisplay({
    responsibleName: proposal.responsibleName,
    responsibleUser: proposal.responsibleUser,
    user: proposal.user,
  });

  // Data/hora e prazo saem FORMATADOS daqui. O client component não pode chamar
  // `toLocale*` nem `Date.now()` no render: o padrão de locale do ICU do Node
  // difere do ICU do browser e o "faltam Xd" muda entre o SSR e a hidratação —
  // os dois viram texto diferente no mesmo nó e derrubam a hidratação (React
  // #418/#423, que faz a página re-renderizar do zero e o card "Documento"
  // aparecer vazio). Ver lib/format/datetime.ts.
  const prazo = proposalDeadline(proposal.validUntil, proposal.status);

  // Insumos do braço "enviar ao proprietário" da parada de decisão: linhas de
  // vendedor do plano + pendência de preflight por linha + custo previsto.
  const vendedorRows = planSigners.filter((ps) => ps.role === "vendedor" && ps.included);
  const planVendedores = vendedorRows.map((ps) => {
    const issues = checkProposalReadiness([
      { name: ps.name, email: ps.email, cpf: ps.cpf, phone: ps.phone, notifyChannel: ps.notifyChannel ?? "email" },
    ]);
    return {
      id: ps.id,
      name: ps.name,
      email: ps.email,
      phone: ps.phone,
      issue: issues.length > 0 ? issues.map((i) => i.reason).join("; ") : null,
    };
  });
  let vendedorCostLabel: string | null = null;
  if (vendedorRows.length > 0) {
    const settings = await getSignatureSettings(org.id);
    const cents = plannedProposalCostCents({
      signerCount: vendedorRows.length,
      costOverrides: settings.costOverridesJson as Record<string, unknown> | null,
    });
    vendedorCostLabel = formatMoneyBR(cents / 100);
  }

  const permissions = {
    send: can(eff, PERMISSION.PROPOSAL_SEND),
    // Escrita na proposta (renomear, editar). Espelha o guard das rotas PATCH
    // /api/proposals/[id] e .../title: não existe PROPOSAL_UPDATE, então o corte
    // é quem cria OU envia. VIEW_ALL sozinho é LEITURA e não entra aqui.
    write:
      can(eff, PERMISSION.PROPOSAL_CREATE) || can(eff, PERMISSION.PROPOSAL_SEND),
    create: can(eff, PERMISSION.PROPOSAL_CREATE),
    convert: can(eff, PERMISSION.PROPOSAL_CONVERT),
    cancel: can(eff, PERMISSION.PROPOSAL_CANCEL),
    delete: can(eff, PERMISSION.PROPOSAL_DELETE),
    resend: can(eff, PERMISSION.PROPOSAL_RESEND),
    assign: can(eff, PERMISSION.PROPOSAL_ASSIGN),
  };

  return (
    <ProposalDetailClient
      proposal={{
        id: proposal.id,
        code: proposal.code,
        title: proposal.title,
        status: proposal.status,
        kind: proposal.kind,
        instrument: proposal.instrument,
        hasEnvelopes: envelopeCount > 0,
        createdAtLabel: formatDateTimeBR(proposal.createdAt),
        sentAtLabel: formatDateTimeBR(proposal.sentAt),
        sentAt: proposal.sentAt?.toISOString() ?? null,
        lastSendOutcome: lastOutcome?.eventName ?? null,
        deliveredAtLabel: formatDateTimeBR(proposal.deliveredAt),
        firstViewedAtLabel: formatDateTimeBR(proposal.firstViewedAt),
        viewCount: proposal.viewCount,
        lastReminderAtLabel: formatDateTimeBR(proposal.lastReminderAt),
        reminderCount: proposal.reminderCount,
        validUntilLabel: formatDateTimeBR(proposal.validUntil),
        prazo: { label: prazo.label, danger: prazo.tone === "danger" },
        updatedAtIso: proposal.updatedAt.toISOString(),
        convertedDealId: proposal.convertedDealId,
        supersededById: proposal.supersededById,
        thread: { parent: parentRef, supersededBy: supersededRef },
        dossierUrl: proposal.dossierUrl,
        resumo,
        detalhes: summarizeProposalDetails(d, proposal.kind),
        responsible: resp,
        responsibleUserId: proposal.responsibleUserId,
        responsibleName: proposal.responsibleName,
        creatorName: proposal.user?.name ?? null,
        parceiros,
        templateName: proposal.template?.name ?? null,
        // Link rastreado /p/[token] — só chega aqui DEPOIS do gate de acesso
        // acima (a página é autenticada); a rota pública em si não o expõe.
        publicUrl: proposalPublicLink(proposal.token),
        vendedorDeadlineLabel: proposal.vendedorDeadlineAt
          ? formatDateTimeBR(proposal.vendedorDeadlineAt)
          : null,
        reservedCostLabel:
          proposal.reservedCostCents > 0
            ? formatMoneyBR(proposal.reservedCostCents / 100)
            : null,
        comissaoIncluida: proposal.comissaoIncluida,
        // Helper canônico (não `includes("comissao")` exato): é o mesmo que o
        // render usa pra decidir a via reduzida — um sub-path `comissao.*`
        // futuro divergiria badge e documento.
        comissaoOculta: hidesComissao(proposal.hiddenPaths),
        recusa: proposal.refusedAt
          ? {
              // `refusedBy` não é persistido pelo fluxo de Aceite — o STATUS
              // terminal carrega a mesma informação e serve de fallback.
              porLabel: refusedByLabel(proposal.refusedBy, proposal.status),
              emLabel: formatDateTimeBR(proposal.refusedAt),
              reason: proposal.refusedReason,
              counterLabel:
                proposal.counterAmount != null && proposal.counterAmount > 0
                  ? formatMoneyBR(proposal.counterAmount)
                  : null,
            }
          : null,
      }}
      // Documento congelado no envio. Vai inteiro pro client porque é ele que a
      // janela "Documento" exibe quando a proposta já saiu — re-renderizar o
      // template atual mostraria um texto que ninguém assinou.
      sentSnapshotHtml={proposal.sentSnapshotHtml}
      signers={signers.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        channel: s.channel,
        status: s.status,
      }))}
      events={events.map((e) => ({
        id: e.id,
        eventName: e.eventName,
        receivedAtLabel: formatDateTimeBR(e.receivedAt),
        detail: extractEventDetail(e.payload),
      }))}
      attachments={attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        category: a.category,
        url: a.url,
        mime: a.mime,
        source: a.source,
        status: a.status,
        extractError: a.extractError,
        extractedData: (a.extractedData as Record<string, unknown> | null) ?? null,
        createdAt: a.createdAt.toISOString(),
      }))}
      creditFeatureEnabled={creditFeatureEnabled}
      partiesSnapshot={partiesSnapshot}
      pretendentes={pretendentes}
      creditConsent={creditConsent}
      tipoImovel={tipoImovel}
      members={memberRows.map((m) => ({ id: m.user.id, name: m.user.name ?? "Sem nome" }))}
      permissions={permissions}
      planVendedores={planVendedores}
      vendedorCostLabel={vendedorCostLabel}
      vendedorIncluded={vendedorRows.length > 0}
      // `completed_manually` só nasce em assinada_proponente (guard do
      // complete) — é o registro direto de que a via do proprietário foi
      // PULADA, não assinada. O stepper usa pra não dar check em quem não
      // assinou (achado de QA 2026-08-18).
      vendedorSkipped={events.some((e) => e.eventName === "completed_manually")}
    />
  );
}

function refusedByLabel(refusedBy: string | null, status: string): string | null {
  if (refusedBy === "proponente" || status === "recusada_proponente") {
    return "pelo proponente";
  }
  if (refusedBy?.startsWith("vendedor") || status === "recusada_vendedor") {
    return "pelo proprietário";
  }
  return null;
}

/**
 * Razão legível de um evento a partir do payload (falhas da 2ª via, preflight,
 * substituição de envelope). Null quando não há nada digno de mostrar.
 */
function extractEventDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    error?: unknown;
    reason?: unknown;
    status?: unknown;
    issues?: Array<{ reason?: unknown }>;
  };
  if (typeof p.error === "string" && p.error) return p.error;
  if (Array.isArray(p.issues)) {
    const reasons = p.issues
      .map((i) => (typeof i?.reason === "string" ? i.reason : null))
      .filter(Boolean);
    if (reasons.length > 0) return reasons.join("; ");
  }
  if (typeof p.reason === "string" && p.reason) return p.reason;
  if (typeof p.status === "string" && p.status) return `status: ${p.status}`;
  return null;
}
