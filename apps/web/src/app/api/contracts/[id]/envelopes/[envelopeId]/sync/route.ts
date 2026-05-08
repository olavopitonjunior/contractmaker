import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  getEnvelope,
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
    const [envResp, signersResp, requirementsResp] = await Promise.all([
      getEnvelope(envelope.clicksignId),
      listEnvelopeSigners(envelope.clicksignId),
      listEnvelopeRequirements(envelope.clicksignId),
    ]);

    const remoteStatus = (
      envResp as { data?: { attributes?: { status?: string } } }
    ).data?.attributes?.status;

    // ClickSign v3: status do signer (signed/viewed/refused) NÃO está
    // em /signers — está nos requirements. Cada signer tem 2:
    //   - action="agree"            → fulfilled = signou
    //   - action="provide_evidence" → fulfilled = autenticou (~viewed)
    // Indexamos por signerId pra cruzar com nossos signers locais.
    const reqsBySigner = indexRequirementsBySigner(requirementsResp);

    let signersUpdated = 0;
    for (const local of envelope.signers) {
      if (!local.clicksignId) continue;
      const reqs = reqsBySigner.get(local.clicksignId) ?? [];

      const agree = reqs.find((r) => r.action === "agree");
      const evidence = reqs.find((r) => r.action === "provide_evidence");

      const updates: Prisma.EnvelopeSignerUpdateInput = {};

      const isSigned = agree?.status === "fulfilled";
      const isAuthenticated = evidence?.status === "fulfilled";
      const isRefused =
        agree?.status === "refused" || evidence?.status === "refused";

      if (isRefused && local.status !== "refused") {
        updates.status = "refused";
        const refusedAt = parseDate(
          agree?.refused_at ?? evidence?.refused_at
        );
        if (refusedAt) updates.refusedAt = refusedAt;
      } else if (isSigned) {
        if (local.status !== "signed") updates.status = "signed";
        const signedAt = parseDate(agree?.fulfilled_at);
        if (signedAt && (!local.signedAt || +signedAt !== +local.signedAt)) {
          updates.signedAt = signedAt;
        }
      } else if (
        isAuthenticated &&
        local.status !== "signed" &&
        local.status !== "viewed"
      ) {
        updates.status = "viewed";
        const viewedAt = parseDate(evidence?.fulfilled_at);
        if (viewedAt && (!local.viewedAt || +viewedAt !== +local.viewedAt)) {
          updates.viewedAt = viewedAt;
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

interface RemoteRequirement {
  id: string;
  action: string;
  status: string;
  fulfilled_at?: string | null;
  refused_at?: string | null;
  signerId: string | null;
}

/**
 * Constrói um índice signerId → requirements[] a partir do payload
 * JSON:API da ClickSign. O signerId fica em
 * `relationships.signer.data.id` de cada requirement.
 */
function indexRequirementsBySigner(
  resp: unknown
): Map<string, RemoteRequirement[]> {
  const out = new Map<string, RemoteRequirement[]>();
  const data = (resp as { data?: unknown }).data;
  if (!Array.isArray(data)) return out;

  for (const item of data as Array<{
    id: string;
    attributes?: {
      action?: string;
      status?: string;
      fulfilled_at?: string | null;
      refused_at?: string | null;
    };
    relationships?: {
      signer?: { data?: { id?: string } };
    };
  }>) {
    const signerId = item.relationships?.signer?.data?.id ?? null;
    if (!signerId) continue;
    const req: RemoteRequirement = {
      id: item.id,
      action: item.attributes?.action ?? "",
      status: item.attributes?.status ?? "",
      fulfilled_at: item.attributes?.fulfilled_at ?? null,
      refused_at: item.attributes?.refused_at ?? null,
      signerId,
    };
    const arr = out.get(signerId) ?? [];
    arr.push(req);
    out.set(signerId, arr);
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
