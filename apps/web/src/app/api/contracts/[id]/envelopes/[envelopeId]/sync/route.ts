import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  getEnvelope,
  listEnvelopeEvents,
  listEnvelopeRequirements,
  listEnvelopeSigners,
} from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";
import { uploadBufferToStorage } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/contracts/[id]/envelopes/[envelopeId]/sync
 *
 * Pulla o estado atual do envelope direto da ClickSign API e reconcilia
 * com o DB local — sem esperar webhook nem cron diário. Usado pelo
 * botão "Atualizar" da aba Assinaturas.
 *
 * Atualiza por signer: status (notified→viewed→signed→refused),
 * `signedAt`, `viewedAt`, `refusedAt`. Atualiza envelope:
 * `status` (running→closed/canceled) e baixa PDF assinado se aplicável.
 *
 * Idempotente — só faz update quando o estado remoto difere do local.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const envelope = await prisma.envelope.findFirst({
    where: {
      id: params.envelopeId,
      contractId: params.id,
      orgId: ctx.orgId,
    },
    include: { signers: true },
  });
  if (!envelope) {
    return NextResponse.json(
      { error: "Envelope não encontrado" },
      { status: 404 }
    );
  }
  if (!envelope.clicksignId) {
    return NextResponse.json(
      { error: "Envelope ainda não tem ID na ClickSign" },
      { status: 400 }
    );
  }

  try {
    const [envResp, signersResp, requirementsResp, eventsResp] =
      await Promise.all([
        getEnvelope(envelope.clicksignId),
        listEnvelopeSigners(envelope.clicksignId),
        listEnvelopeRequirements(envelope.clicksignId),
        listEnvelopeEvents(envelope.clicksignId).catch(() => null),
      ]);

    const remoteStatus = (
      envResp as { data?: { attributes?: { status?: string } } }
    ).data?.attributes?.status;

    // ClickSign v3: a fonte canônica de quem assinou está em /events.
    // Cada event tem `name` (sign | signature_started | refusal | …) +
    // `data.signer.key` (= signer clicksignId) + `created` (ISO).
    // Iteramos eventos e mantemos por signer o mais "forte":
    //   sign       (assinou)  > signature_started (visualizou) > nada
    const stateBySigner = aggregateEventsBySigner(eventsResp);

    let signersUpdated = 0;
    for (const local of envelope.signers) {
      if (!local.clicksignId) continue;
      const remote = stateBySigner.get(local.clicksignId);
      if (!remote) continue;

      const updates: Prisma.EnvelopeSignerUpdateInput = {};

      if (remote.refusedAt) {
        if (local.status !== "refused") updates.status = "refused";
        if (
          !local.refusedAt ||
          +remote.refusedAt !== +local.refusedAt
        ) {
          updates.refusedAt = remote.refusedAt;
        }
      } else if (remote.signedAt) {
        if (local.status !== "signed") updates.status = "signed";
        if (
          !local.signedAt ||
          +remote.signedAt !== +local.signedAt
        ) {
          updates.signedAt = remote.signedAt;
        }
        // Se assinou, populou viewedAt do signature_started anterior
        if (
          remote.viewedAt &&
          (!local.viewedAt || +remote.viewedAt !== +local.viewedAt)
        ) {
          updates.viewedAt = remote.viewedAt;
        }
      } else if (remote.viewedAt) {
        if (local.status !== "signed" && local.status !== "viewed") {
          updates.status = "viewed";
        }
        if (!local.viewedAt || +remote.viewedAt !== +local.viewedAt) {
          updates.viewedAt = remote.viewedAt;
        }
      }

      if (Object.keys(updates).length > 0) {
        await prisma.envelopeSigner.update({
          where: { id: local.id },
          data: updates,
        });
        signersUpdated += 1;
      }
    }

    let envelopeUpdated = false;
    if (remoteStatus === "closed" && envelope.status !== "closed") {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "closed", closedAt: new Date() },
      });
      const signedUrl = extractSignedUrl(envResp);
      if (signedUrl) void downloadSignedPdf(envelope.id, signedUrl);
      envelopeUpdated = true;
    } else if (remoteStatus === "canceled" && envelope.status !== "canceled") {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "canceled", canceledAt: new Date() },
      });
      envelopeUpdated = true;
    }

    if (signersUpdated > 0 || envelopeUpdated) {
      await prisma.envelopeEvent.create({
        data: {
          envelopeId: envelope.id,
          eventName: "manual_sync",
          payload: {
            signersUpdated,
            envelopeUpdated,
            remoteStatus,
            actorVia: ctx.via,
          } as unknown as Prisma.InputJsonValue,
          source: "manual",
        },
      });
    }

    // ?debug=1 retorna shape cru — útil quando signersUpdated=0 inesperado
    // (ex: ClickSign mudou nome de campo). Sem PII além do que o user já vê.
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    return NextResponse.json({
      ok: true,
      signersUpdated,
      envelopeUpdated,
      remoteStatus,
      ...(debug && {
        debug: {
          envelopeRaw: envResp,
          signersRaw: signersResp,
          requirementsRaw: requirementsResp,
          eventsRaw: eventsResp,
          localSigners: envelope.signers.map((s) => ({
            clicksignId: s.clicksignId,
            name: s.name,
            status: s.status,
            signedAt: s.signedAt,
          })),
        },
      }),
    });
  } catch (err) {
    if (err instanceof ClicksignError) {
      return NextResponse.json(
        { error: `Clicksign: ${err.message}`, status: err.status },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[envelope sync] erro:", msg);
    return NextResponse.json(
      { error: msg || "Erro interno" },
      { status: 500 }
    );
  }
}

interface SignerEventState {
  signedAt: Date | null;
  viewedAt: Date | null;
  refusedAt: Date | null;
}

/**
 * Agrega o histórico de eventos da ClickSign v3 por signer (via
 * `data.signer.key`). Mantém o "estado mais forte" pra cada signer:
 *   sign  → signedAt
 *   signature_started → viewedAt (só se ainda não signed)
 *   refusal → refusedAt
 */
function aggregateEventsBySigner(
  resp: unknown
): Map<string, SignerEventState> {
  const out = new Map<string, SignerEventState>();
  const data = (resp as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return out;

  for (const item of data as Array<{
    attributes?: {
      name?: string;
      created?: string;
      data?: { signer?: { key?: string } };
    };
  }>) {
    const name = item.attributes?.name;
    const signerKey = item.attributes?.data?.signer?.key;
    const createdAt = parseDate(item.attributes?.created);
    if (!name || !signerKey || !createdAt) continue;

    const cur = out.get(signerKey) ?? {
      signedAt: null,
      viewedAt: null,
      refusedAt: null,
    };

    if (name === "sign") {
      // Mantém o evento mais antigo de assinatura caso existam múltiplos
      // (evento idempotente — primeiro indica o momento real).
      if (!cur.signedAt || +createdAt < +cur.signedAt) {
        cur.signedAt = createdAt;
      }
    } else if (name === "signature_started") {
      if (!cur.viewedAt || +createdAt < +cur.viewedAt) {
        cur.viewedAt = createdAt;
      }
    } else if (name === "refusal") {
      if (!cur.refusedAt || +createdAt < +cur.refusedAt) {
        cur.refusedAt = createdAt;
      }
    }

    out.set(signerKey, cur);
  }
  return out;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractSignedUrl(resp: unknown): string | null {
  const included = (resp as {
    included?: Array<{ attributes?: Record<string, unknown> }>;
  }).included;
  if (!Array.isArray(included)) return null;
  for (const item of included) {
    const downloads = item.attributes?.downloads as
      | { signed_file_url?: string }
      | undefined;
    if (downloads?.signed_file_url) return downloads.signed_file_url;
  }
  return null;
}

async function downloadSignedPdf(envelopeId: string, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const stored = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key: `envelopes/${envelopeId}/signed.pdf`,
      body: buf,
      contentType: "application/pdf",
    });
    await prisma.envelope.update({
      where: { id: envelopeId },
      data: { signedDocumentUrl: stored },
    });

    const env = await prisma.envelope.findUnique({
      where: { id: envelopeId },
      select: {
        dealId: true,
        source: true,
        name: true,
        contract: { select: { version: true } },
      },
    });
    if (env?.dealId) {
      const existing = await prisma.dealAttachment.findFirst({
        where: { dealId: env.dealId, url: stored },
        select: { id: true },
      });
      if (!existing) {
        const category =
          env.source === "attachment" ? "documento_assinado" : "contrato_assinado";
        const filename = env.contract
          ? `Contrato assinado v${env.contract.version}.pdf`
          : `${env.name} (assinado).pdf`;
        await prisma.dealAttachment.create({
          data: {
            dealId: env.dealId,
            filename,
            mime: "application/pdf",
            url: stored,
            category,
            source: "clicksign_signed",
          },
        });
      }
    }
  } catch (err) {
    console.error("[envelope sync] falha download PDF assinado:", err);
  }
}
