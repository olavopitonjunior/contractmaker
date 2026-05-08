import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getEnvelope, listEnvelopeSigners } from "@/lib/clicksign/envelopes";
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
    const [envResp, signersResp] = await Promise.all([
      getEnvelope(envelope.clicksignId),
      listEnvelopeSigners(envelope.clicksignId),
    ]);

    const remoteStatus = (
      envResp as { data?: { attributes?: { status?: string } } }
    ).data?.attributes?.status;

    const remoteSigners = extractSigners(signersResp);

    let signersUpdated = 0;
    for (const local of envelope.signers) {
      if (!local.clicksignId) continue;
      const remote = remoteSigners.find((r) => r.id === local.clicksignId);
      if (!remote) continue;

      const updates: Prisma.EnvelopeSignerUpdateInput = {};

      // Mapeia status remoto → local. ClickSign v3 retorna status como
      // string textual; mantemos defensivo com fallback no estado atual.
      const remoteStatusVal = remote.attributes.status?.toLowerCase();
      const newStatus = mapSignerStatus(remoteStatusVal, local.status);
      if (newStatus !== local.status) updates.status = newStatus;

      const signedAt = parseDate(remote.attributes.signed_at);
      if (signedAt && (!local.signedAt || +signedAt !== +local.signedAt)) {
        updates.signedAt = signedAt;
      }
      const viewedAt = parseDate(remote.attributes.viewed_at);
      if (viewedAt && (!local.viewedAt || +viewedAt !== +local.viewedAt)) {
        updates.viewedAt = viewedAt;
      }
      const refusedAt = parseDate(remote.attributes.refused_at);
      if (refusedAt && (!local.refusedAt || +refusedAt !== +local.refusedAt)) {
        updates.refusedAt = refusedAt;
      }
      const notifiedAt = parseDate(remote.attributes.notified_at);
      if (
        notifiedAt &&
        (!local.notifiedAt || +notifiedAt !== +local.notifiedAt)
      ) {
        updates.notifiedAt = notifiedAt;
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

    return NextResponse.json({
      ok: true,
      signersUpdated,
      envelopeUpdated,
      remoteStatus,
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

interface RemoteSigner {
  id: string;
  attributes: {
    status?: string;
    signed_at?: string | null;
    viewed_at?: string | null;
    refused_at?: string | null;
    notified_at?: string | null;
  };
}

function extractSigners(resp: unknown): RemoteSigner[] {
  const data = (resp as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data as RemoteSigner[];
}

function mapSignerStatus(
  remote: string | undefined,
  fallback: string
): string {
  if (!remote) return fallback;
  // ClickSign v3 pode retornar variantes; normaliza pros estados locais.
  if (remote === "signed" || remote === "sign") return "signed";
  if (remote === "refused" || remote === "refusal") return "refused";
  if (remote === "viewed" || remote === "signature_started") return "viewed";
  if (remote === "notified" || remote === "pending_action") return "notified";
  if (remote === "removed" || remote === "deleted") return "removed";
  return fallback;
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
