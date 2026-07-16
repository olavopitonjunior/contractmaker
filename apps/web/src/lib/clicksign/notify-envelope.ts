import { prisma } from "@/lib/db/prisma";
import { emitNotification } from "@/lib/notifications/emit";

/**
 * Emite Notification (sino) pros marcos críticos de assinatura, que antes
 * passavam sem rastro pro operador: contrato assinado, recusa e bounce de
 * e-mail. Fire-and-forget e escopado por org (userId null = org-wide, mesmo
 * padrão das notificações de certidões).
 *
 * SÓ pra envelope de contrato/attachment: um envelope de PROPOSTA (pré-negócio,
 * source="proposal", sem deal no kanban) NÃO entra aqui. A wording é de
 * contrato ("Contrato assinado", "pasta do negócio") e proposta tem máquina de
 * status própria (onProposalEnvelope*). Marcos de proposta (incl. bounce) são
 * feature separada do módulo de propostas — BACKLOG, não regressão: antes deste
 * lote proposta nunca teve sino de marco de envelope.
 *
 * `linkUrl` é resolvido pelo CHAMADOR (uma vez por envelope) e passado pronto —
 * a query da esteira NÃO fica dentro do try do emit (senão um erro de DB no
 * link secundário engoliria o sino inteiro) nem se repete por signatário.
 *
 * `dedupeSuffix` entra no batchId: pra "signed"/"refused" é uma notificação
 * por envelope; pra "email_failed" o chamador passa o signerId, senão o bounce
 * de um 2º signatário seria engolido pelo unique (type, batchId) do model.
 */
type EnvelopeNotifKind = "signed" | "refused" | "email_failed";

const TEXT: Record<EnvelopeNotifKind, { type: string; title: string; body: string }> = {
  signed: {
    type: "envelope_signed",
    title: "Contrato assinado",
    body: "Todas as partes assinaram — o documento assinado está sendo baixado pra pasta do negócio.",
  },
  refused: {
    type: "envelope_refused",
    title: "Assinatura recusada",
    body: "Um signatário recusou a assinatura. Verifique o envelope e reenvie se necessário.",
  },
  email_failed: {
    type: "envelope_email_failed",
    title: "Falha no e-mail de assinatura",
    body: "O e-mail de assinatura não chegou (bounce). Confira o endereço do signatário e reenvie.",
  },
};

/**
 * Monta o link do deal respeitando a esteira (locação → /locacao/deals). Best-
 * effort: o link é secundário e nunca deve impedir o sino. Nunca lança. Em erro
 * de DB devolve `undefined` (sino sem link) em vez de adivinhar `/deals/` — pra
 * um deal de locação, `/deals/` levaria a 404/módulo errado; melhor sem link.
 */
export async function resolveDealLink(
  dealId: string | null | undefined
): Promise<string | undefined> {
  if (!dealId) return undefined;
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { pipeline: { select: { kind: true } } },
    });
    return deal?.pipeline?.kind === "locacao"
      ? `/locacao/deals/${dealId}`
      : `/deals/${dealId}`;
  } catch {
    return undefined;
  }
}

export async function notifyEnvelopeMilestone(params: {
  envelopeId: string;
  orgId: string;
  /** Origem do envelope — só "contract"/"attachment" geram sino. */
  source: string;
  dealId: string | null;
  /** Link já resolvido pelo chamador via `resolveDealLink`. */
  linkUrl?: string;
  kind: EnvelopeNotifKind;
  /** Discriminador extra do batchId (ex.: signerId pro bounce por signatário). */
  dedupeSuffix?: string;
}): Promise<void> {
  const { envelopeId, orgId, source, dealId, linkUrl, kind, dedupeSuffix } = params;
  if (source !== "contract" && source !== "attachment") return;
  try {
    const t = TEXT[kind];
    const batchId = `${envelopeId}:${kind}${dedupeSuffix ? `:${dedupeSuffix}` : ""}`;
    await emitNotification({
      orgId,
      type: t.type,
      title: t.title,
      body: t.body,
      linkUrl,
      batchId,
      metadata: { envelopeId, ...(dealId ? { dealId } : {}) },
    });
  } catch (err) {
    // Sino nunca quebra o webhook.
    console.error(
      "[clicksign/notify-envelope] falhou:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
