import { emitNotification } from "@/lib/notifications/emit";

/**
 * Sino pros marcos de PROPOSTA (pré-negócio) — espelha o padrão de
 * lib/clicksign/notify-envelope.ts, que exclui `source="proposal"` de
 * propósito (wording de contrato + máquina de status própria). Antes deste
 * lote, aceite/recusa/expiração de proposta passavam sem nenhum rastro pro
 * operador além do status na lista.
 *
 * Kinds:
 *   - completed:      proponente aceitou / todas as vias assinadas → proposta
 *                     completa (o marco que pede ação: converter em negócio)
 *   - accepted_party: um TERCEIRO (proprietário) aceitou o termo dele —
 *                     por-signatário, suffix obrigatório
 *   - refused:        recusa; `refusedBy` ajusta o body (proponente = frio,
 *                     vendedor = quente: comprador já comprometido na mão)
 *   - expired:        termo do proponente venceu sem aceite (CC art. 431)
 *   - email_failed:   bounce do e-mail do envelope de proposta — suffix =
 *                     signerId (senão o 2º bounce é engolido pelo unique)
 *
 * Dedupe pela `@@unique([type, batchId])` do Notification:
 * batchId = `proposal:{proposalId}:{kind}[:{suffix}]` — webhook reentregue
 * ou sync repetido não duplica o sino. Fire-and-forget: NUNCA lança.
 */
export type ProposalNotifKind =
  | "completed"
  | "accepted_party"
  | "refused"
  | "expired"
  | "email_failed";

const TEXT: Record<ProposalNotifKind, { type: string; title: string; body: string }> = {
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
};

const REFUSED_BODY: Record<string, string> = {
  proponente: "O proponente recusou a proposta.",
  vendedor:
    "O proprietário recusou — há um comprador comprometido aguardando. Priorize o contato.",
};

export async function notifyProposalMilestone(params: {
  proposalId: string;
  orgId: string;
  kind: ProposalNotifKind;
  /** Quem recusou (só pra kind="refused") — ajusta o body. */
  refusedBy?: "proponente" | "vendedor";
  /** Discriminador extra do batchId (signerId em accepted_party/email_failed). */
  dedupeSuffix?: string;
}): Promise<void> {
  const { proposalId, orgId, kind, refusedBy, dedupeSuffix } = params;
  try {
    const t = TEXT[kind];
    const body =
      kind === "refused" && refusedBy ? REFUSED_BODY[refusedBy] ?? t.body : t.body;
    const batchId = `proposal:${proposalId}:${kind}${dedupeSuffix ? `:${dedupeSuffix}` : ""}`;
    await emitNotification({
      orgId,
      type: t.type,
      title: t.title,
      body,
      linkUrl: `/pipeline/propostas/${proposalId}`,
      batchId,
      metadata: { proposalId, ...(refusedBy ? { refusedBy } : {}) },
    });
  } catch (err) {
    // Sino nunca quebra webhook/sync.
    console.error(
      "[proposals/notify] falhou:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
