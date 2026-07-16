import { prisma } from "@/lib/db/prisma";
import { emitNotification } from "@/lib/notifications/emit";

/**
 * Emite Notification (sino) pros marcos críticos de assinatura, que antes
 * passavam sem rastro pro operador: contrato assinado, recusa e bounce de
 * e-mail. Fire-and-forget e escopado por org (userId null = org-wide, mesmo
 * padrão das notificações de certidões).
 *
 * `batchId` = `${envelopeId}:${kind}` → o unique (type, batchId) do model
 * dedupa reentregas do webhook (o mesmo envelope fechado 2× não gera 2 sinos).
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

export async function notifyEnvelopeMilestone(
  envelopeId: string,
  orgId: string,
  kind: EnvelopeNotifKind
): Promise<void> {
  try {
    const envelope = await prisma.envelope.findUnique({
      where: { id: envelopeId },
      select: { dealId: true },
    });
    const dealId = envelope?.dealId ?? null;
    const t = TEXT[kind];
    await emitNotification({
      orgId,
      type: t.type,
      title: t.title,
      body: t.body,
      linkUrl: dealId ? `/deals/${dealId}` : undefined,
      batchId: `${envelopeId}:${kind}`,
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
