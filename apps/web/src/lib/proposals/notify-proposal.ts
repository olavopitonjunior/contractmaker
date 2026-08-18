import { prisma } from "@/lib/db/prisma";
import { emitNotification } from "@/lib/notifications/emit";

/**
 * Sino pros marcos de PROPOSTA (pré-negócio) — espelha o padrão de
 * lib/clicksign/notify-envelope.ts, que exclui `source="proposal"` de
 * propósito (wording de contrato + máquina de status própria). Antes deste
 * lote, aceite/recusa/expiração de proposta passavam sem nenhum rastro pro
 * operador além do status na lista.
 *
 * ESCOPO POR DONO: proposta é owner-scoped (canAccessProposal — corretor vê
 * só as dele; a página 404a pra terceiros). O sino vai pro `userId` dono, e
 * NÃO org-wide — broadcast vazaria atividade que o RBAC esconde e o link
 * quebraria pra quem não pode ver.
 *
 * Kinds:
 *   - delivered:      a proposta CHEGOU numa das partes (Aceite: a ClickSign
 *                     confirma a entrega) — por-signatário, suffix obrigatório
 *   - signed_proponente: o proponente assinou e a proposta seguiu pro
 *                     proprietário — o intervalo em que o corretor ficava cego
 *   - completed:      proponente aceitou / todas as vias assinadas → proposta
 *                     completa (o marco que pede ação: converter em negócio)
 *   - accepted_party: um TERCEIRO (proprietário) aceitou o termo dele —
 *                     por-signatário, suffix obrigatório
 *   - refused:        recusa; `refusedBy` ajusta o body (recusa do
 *                     proprietário pede follow-up com o comprador)
 *   - expired:        termo do proponente venceu sem aceite (CC art. 431)
 *   - email_failed:   bounce do e-mail do envelope de proposta — suffix =
 *                     signerId (senão o 2º bounce é engolido pelo unique)
 *
 * Dedupe pela `@@unique([type, batchId])` do Notification:
 * batchId = `proposal:{proposalId}:{kind}[:{suffix}]`. `emitNotification`
 * nunca lança (engole P2002 e erros) — sino nunca quebra webhook/sync.
 *
 * O texto chega no WhatsApp do corretor como `${title}: ${body}`
 * (user-channels-registry.ts) — sem o `linkUrl`. Por isso os marcos de
 * acompanhamento carregam o caminho da proposta no próprio body: quem pediu a
 * proposta pelo WhatsApp não tem outra porta de entrada pra ela.
 */
export type ProposalNotifKind =
  | "delivered"
  | "signed_proponente"
  | "completed"
  | "accepted_party"
  | "refused"
  | "expired"
  | "email_failed"
  // Handoff com decisão humana (2026-08):
  //   - awaiting_decision: o proponente assinou e a proposta PAROU esperando a
  //     decisão do corretor (enviar 2ª via ou concluir) — o sino é o CTA.
  //   - vendedor_sent: a 2ª via foi criada por caminho NÃO-manual (webhook com
  //     auto-chain ligado, cron) — quem clicou no botão já viu o resultado.
  //   - vendedor_send_failed: a 2ª via falhou (no_creds/preflight/budget/error/
  //     cancelada na ClickSign). Era o buraco operacional: a falha só aparecia
  //     em ProposalEvent que ninguém abria.
  | "awaiting_decision"
  | "vendedor_sent"
  | "vendedor_send_failed";

const TEXT: Record<ProposalNotifKind, { type: string; title: string; body: string }> = {
  delivered: {
    type: "proposal_delivered",
    title: "Proposta entregue",
    body: "A proposta chegou ao destinatário. Aviso aqui quando ele assinar.",
  },
  signed_proponente: {
    type: "proposal_signed_proponente",
    title: "Proponente assinou",
    body: "O proponente assinou. A proposta seguiu para o proprietário assinar.",
  },
  completed: {
    type: "proposal_completed",
    title: "Proposta aceita",
    body: "O proponente aceitou a proposta. Revise e converta em negócio no pipeline.",
  },
  accepted_party: {
    type: "proposal_accepted_party",
    title: "Parte aceitou a proposta",
    body: "Um participante registrou o aceite do termo dele. Aguardando o proponente.",
  },
  refused: {
    type: "proposal_refused",
    title: "Proposta recusada",
    body: "A proposta foi recusada. Veja o detalhe pra entender o desfecho.",
  },
  expired: {
    type: "proposal_expired",
    title: "Proposta expirada",
    body: "O prazo de validade venceu sem aceite do proponente. Reenvie com novo prazo se o negócio seguir vivo.",
  },
  email_failed: {
    type: "proposal_email_failed",
    title: "Falha no e-mail da proposta",
    body: "O e-mail do envelope da proposta não chegou (bounce). Confira o endereço e reenvie.",
  },
  awaiting_decision: {
    type: "proposal_awaiting_decision",
    title: "Proponente assinou — sua vez",
    body: "O proponente assinou. Decida: enviar a 2ª via ao proprietário ou concluir sem enviar.",
  },
  vendedor_sent: {
    type: "proposal_vendedor_sent",
    title: "2ª via enviada ao proprietário",
    body: "A via do proprietário foi enviada para assinatura. Aviso aqui quando ele assinar.",
  },
  vendedor_send_failed: {
    type: "proposal_vendedor_send_failed",
    title: "Falha na 2ª via ao proprietário",
    body: "A via do proprietário não pôde ser enviada. Abra a proposta para ver o motivo e corrigir.",
  },
};

/** Marcos de andamento — os que pedem um link clicável no WhatsApp. */
const TRACKING_KINDS = new Set<ProposalNotifKind>([
  "delivered",
  "signed_proponente",
  "awaiting_decision",
  "vendedor_send_failed",
]);

function appUrl(): string {
  return process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
}

const REFUSED_BODY: Record<"proponente" | "vendedor", string> = {
  proponente: "O proponente recusou a proposta.",
  // Copy válida ANTES e DEPOIS da assinatura do proponente (com o alargamento
  // de recusada_vendedor, a recusa pode chegar pré-assinatura — não dá pra
  // afirmar "comprador comprometido" sempre).
  vendedor:
    "O proprietário recusou a proposta. Se o comprador já assinou/aceitou, priorize o contato com ele.",
};

export async function notifyProposalMilestone(params: {
  proposalId: string;
  orgId: string;
  /** Dono da proposta (Proposal.userId) — o sino é dele, não da org inteira. */
  userId: string;
  kind: ProposalNotifKind;
  /** Quem recusou (só pra kind="refused") — ajusta o body. */
  refusedBy?: "proponente" | "vendedor";
  /** Discriminador extra do batchId (signerId em accepted_party/email_failed). */
  dedupeSuffix?: string;
  /** Body específico do contexto (ex.: accepted_party pós-completa). */
  bodyOverride?: string;
}): Promise<void> {
  const { proposalId, orgId, userId, kind, refusedBy, dedupeSuffix, bodyOverride } = params;
  const t = TEXT[kind];
  const baseBody =
    bodyOverride ?? (kind === "refused" && refusedBy ? REFUSED_BODY[refusedBy] : t.body);
  // Marcos de acompanhamento levam o link ABSOLUTO no corpo: quem pediu a
  // proposta pelo WhatsApp recebe só `${title}: ${body}`, sem o linkUrl do sino,
  // e não tem outra porta de entrada pra ela.
  const body = TRACKING_KINDS.has(kind)
    ? `${baseBody} ${appUrl()}/pipeline/propostas/${proposalId}`
    : baseBody;
  const batchId = `proposal:${proposalId}:${kind}${dedupeSuffix ? `:${dedupeSuffix}` : ""}`;

  // Dono que SAIU da org: o sino escopado iria pra alguém que não vê mais
  // nada (e o batchId único impediria re-emitir). Fallback: OWNERS/ADMINS da
  // org (que têm visão total das propostas) — NUNCA broadcast org-wide, que
  // vazaria atividade que o RBAC esconde de members e cujo link 404a pra
  // eles. batchId por destinatário no fallback (o unique é [type, batchId]).
  // Best-effort: erro na checagem mantém o escopo por dono.
  let recipients: Array<{ userId: string; batchSuffix: string }> = [
    { userId, batchSuffix: "" },
  ];
  try {
    const member = await prisma.orgMembership.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!member) {
      // Guard de REPLAY antes do fan-out: IGUALDADE no batchId base — só a
      // emissão escopada no dono (feita quando ele ainda era membro) usa o
      // base; se ela existe, o marco já foi entregue e o webhook reentregue
      // não re-toca pros admins. Igualdade (não startsWith): os :u: do
      // próprio fan-out são deduplicados pelo unique [type, batchId] de cada
      // um — um replay do fan-out vira P2002 engolido, não duplicata.
      const alreadyEmitted = await prisma.notification.findFirst({
        where: { orgId, type: t.type, batchId },
        select: { id: true },
      });
      if (alreadyEmitted) return;
      const admins = await prisma.orgMembership.findMany({
        where: { orgId, role: { in: ["owner", "admin"] } },
        select: { userId: true },
      });
      if (admins.length === 0) {
        // Estado degenerado (org sem owner/admin): NÃO emite nada — uma
        // emissão invisível com o batchId base bloquearia o fan-out quando
        // um admin fosse adicionado e o webhook reentregue.
        console.warn(
          "[proposals/notify] org sem owner/admin — sino de marco pulado",
          { orgId, proposalId, kind }
        );
        return;
      }
      recipients = admins.map((a) => ({
        userId: a.userId,
        batchSuffix: `:u:${a.userId}`,
      }));
    }
  } catch {
    // mantém escopado no dono
  }

  await Promise.all(
    recipients.map((r) =>
      emitNotification({
        orgId,
        userId: r.userId,
        type: t.type,
        title: t.title,
        body,
        linkUrl: `/pipeline/propostas/${proposalId}`,
        batchId: `${batchId}${r.batchSuffix}`,
        metadata: { proposalId, ...(refusedBy ? { refusedBy } : {}) },
      })
    )
  );
}
