import { emitNotification } from "@/lib/notifications/emit";

/**
 * Emite Notification (sino) pros marcos críticos de assinatura, que antes
 * passavam sem rastro pro operador: contrato assinado, recusa e bounce de
 * e-mail. Fire-and-forget e escopado por org (userId null = org-wide, mesmo
 * padrão das notificações de certidões).
 *
 * `dealId` vem do chamador (que já tem o envelope carregado) — sem re-query.
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

export async function notifyEnvelopeMilestone(params: {
  envelopeId: string;
  orgId: string;
  dealId: string | null;
  kind: EnvelopeNotifKind;
  /** Discriminador extra do batchId (ex.: signerId pro bounce por signatário). */
  dedupeSuffix?: string;
}): Promise<void> {
  const { envelopeId, orgId, dealId, kind, dedupeSuffix } = params;
  try {
    const t = TEXT[kind];
    const batchId = `${envelopeId}:${kind}${dedupeSuffix ? `:${dedupeSuffix}` : ""}`;
    await emitNotification({
      orgId,
      type: t.type,
      title: t.title,
      body: t.body,
      linkUrl: dealId ? `/deals/${dealId}` : undefined,
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
