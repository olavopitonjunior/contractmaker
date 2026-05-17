import { prisma } from "@/lib/db/prisma";
import { clicksignRequest } from "./client";

/**
 * Cancela envelope na ClickSign + atualiza Envelope local.
 *
 * ClickSign API v3: PATCH /api/v3/envelopes/{id} com `data.attributes.status =
 * "canceled"` (JSON:API). Após chamada bem-sucedida, marca `canceledAt` no
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
    select: { id: true, clicksignId: true, status: true },
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

  try {
    await clicksignRequest({
      method: "PATCH",
      path: `/api/v3/envelopes/${encodeURIComponent(envelope.clicksignId)}`,
      body: {
        data: {
          type: "envelopes",
          id: envelope.clicksignId,
          attributes: { status: "canceled" },
        },
      },
    });
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
