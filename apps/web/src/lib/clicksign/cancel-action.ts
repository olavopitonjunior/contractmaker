import { prisma } from "@/lib/db/prisma";
import { cancelEnvelope } from "./envelopes";
import { resolveClickSignCreds } from "./account";

/**
 * Cancela envelope na ClickSign + atualiza Envelope local.
 *
 * A chamada remota é delegada a `envelopes.ts::cancelEnvelope` (v3 cancela POR
 * DOCUMENTO — ver comentário lá). Após sucesso, marca `canceledAt` no
 * registro local + status="canceled".
 *
 * Caller (intent executor ou route) é responsável por: cross-user guard,
 * validar status atual != terminal, garantir clicksignId presente.
 */
export interface RunEnvelopeCancelArgs {
  envelopeId: string;
  reason: string;
  actorUserId: string;
}

export interface RunEnvelopeCancelResult {
  status: number;
  body: unknown;
}

export async function runEnvelopeCancel(
  args: RunEnvelopeCancelArgs
): Promise<RunEnvelopeCancelResult> {
  const envelope = await prisma.envelope.findUnique({
    where: { id: args.envelopeId },
    select: { id: true, clicksignId: true, status: true, orgId: true },
  });
  if (!envelope) {
    return { status: 404, body: { error: "Envelope não encontrado" } };
  }
  if (!envelope.clicksignId) {
    return {
      status: 422,
      body: {
        error:
          "Envelope sem clicksignId (não foi enviado ainda). Use delete em vez de cancel.",
      },
    };
  }
  if (envelope.status === "canceled") {
    // Idempotente — já cancelado
    return {
      status: 200,
      body: {
        ok: true,
        envelopeId: args.envelopeId,
        status: "canceled",
        idempotent: true,
      },
    };
  }

  const creds = await resolveClickSignCreds(envelope.orgId);
  if (!creds) {
    return {
      status: 422,
      body: {
        error:
          "Conta ClickSign não configurada para esta imobiliária — não é possível cancelar remotamente.",
        envelopeId: args.envelopeId,
      },
    };
  }

  try {
    await cancelEnvelope(envelope.clicksignId, creds);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 502,
      body: {
        error: `ClickSign cancel failed: ${message}`,
        envelopeId: args.envelopeId,
      },
    };
  }

  const updated = await prisma.envelope.update({
    where: { id: args.envelopeId },
    data: {
      status: "canceled",
      canceledAt: new Date(),
    },
    select: { id: true, status: true, canceledAt: true },
  });

  return {
    status: 200,
    body: {
      ok: true,
      envelopeId: updated.id,
      status: updated.status,
      canceledAt: updated.canceledAt?.toISOString(),
      reason: args.reason,
    },
  };
}
