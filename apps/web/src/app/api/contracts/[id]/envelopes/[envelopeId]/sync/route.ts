import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  getEnvelope,
  listDocumentFiles,
  listEnvelopeDocuments,
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
    const [envResp, signersResp, requirementsResp, eventsResp, documentsResp] =
      await Promise.all([
        getEnvelope(envelope.clicksignId),
        listEnvelopeSigners(envelope.clicksignId),
        listEnvelopeRequirements(envelope.clicksignId),
        listEnvelopeEvents(envelope.clicksignId).catch(() => null),
        listEnvelopeDocuments(envelope.clicksignId).catch(() => null),
      ]);

    // Pra debug=1: também busca files do primeiro doc pra ver shape v3
    let firstDocFilesResp: unknown = null;
    let firstDocFilesError: string | null = null;
    const firstDocId = (documentsResp as { data?: Array<{ id?: string }> })
      ?.data?.[0]?.id;
    if (firstDocId && envelope.clicksignId) {
      try {
        firstDocFilesResp = await listDocumentFiles(
          envelope.clicksignId,
          firstDocId
        );
      } catch (err) {
        firstDocFilesError =
          err instanceof Error ? err.message : String(err);
      }
    }

    const remoteStatus = (
      envResp as { data?: { attributes?: { status?: string } } }
    ).data?.attributes?.status;

    // ClickSign v3: a fonte canônica de quem assinou está em /events.
    // Cada event tem `name` (sign | signature_started | refusal | …) +
    // `data.signer.key` (= signer clicksignId) + `created` (ISO).
    // Iteramos eventos e mantemos por signer o mais "forte":
    //   sign       (assinou)  > signature_started (visualizou) > nada
    //
    // Match: tentamos primeiro por `signer.key` (clicksignId local). Se
    // não bate, fallback por EMAIL — cobre o caso em que o signer foi
    // editado e a ClickSign emitiu remove_signer + add_signer com nova
    // key, deixando o local desatualizado.
    const stateBySigner = aggregateEventsBySigner(eventsResp);
    const stateByEmail = aggregateEventsByEmail(eventsResp);

    let signersUpdated = 0;
    for (const local of envelope.signers) {
      const byKey = local.clicksignId
        ? stateBySigner.get(local.clicksignId)
        : null;
      const byEmail = stateByEmail.get(local.email.toLowerCase());
      const remote = byKey ?? byEmail;
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
      const signedUrl = await resolveSignedUrl(envelope.clicksignId, envResp);
      if (signedUrl) void downloadSignedPdf(envelope.id, signedUrl);
      envelopeUpdated = true;
    } else if (remoteStatus === "canceled" && envelope.status !== "canceled") {
      await prisma.envelope.update({
        where: { id: envelope.id },
        data: { status: "canceled", canceledAt: new Date() },
      });
      envelopeUpdated = true;
    }

    // Fallback: se já está closed localmente mas o PDF assinado nunca
    // foi baixado (webhook v3 close não traz signed_file_url), tenta
    // baixar agora consultando /documents.
    if (
      remoteStatus === "closed" &&
      envelope.status === "closed" &&
      !envelope.signedDocumentUrl
    ) {
      const signedUrl = await resolveSignedUrl(
        envelope.clicksignId,
        envResp
      );
      if (signedUrl) {
        await downloadSignedPdf(envelope.id, signedUrl);
        envelopeUpdated = true;
      }
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
          documentsRaw: documentsResp,
          firstDocFilesRaw: firstDocFilesResp,
          firstDocFilesError,
          firstDocId,
          aggregatedByEmail: Array.from(stateByEmail.entries()).map(
            ([email, state]) => ({
              email,
              signedAt: state.signedAt,
              viewedAt: state.viewedAt,
              refusedAt: state.refusedAt,
            })
          ),
          aggregatedByKey: Array.from(stateBySigner.entries()).map(
            ([key, state]) => ({
              key,
              signedAt: state.signedAt,
              viewedAt: state.viewedAt,
              refusedAt: state.refusedAt,
            })
          ),
          localSigners: envelope.signers.map((s) => ({
            clicksignId: s.clicksignId,
            name: s.name,
            email: s.email,
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
  return aggregateEventsBy(resp, (e) => e.signer?.key);
}

function aggregateEventsByEmail(
  resp: unknown
): Map<string, SignerEventState> {
  return aggregateEventsBy(resp, (e) => e.signer?.email?.toLowerCase());
}

function aggregateEventsBy(
  resp: unknown,
  pickKey: (data: { signer?: { key?: string; email?: string } }) =>
    | string
    | null
    | undefined
): Map<string, SignerEventState> {
  const out = new Map<string, SignerEventState>();
  const data = (resp as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return out;

  for (const item of data as Array<{
    attributes?: {
      name?: string;
      created?: string;
      data?: { signer?: { key?: string; email?: string } };
    };
  }>) {
    const name = item.attributes?.name;
    const eventData = item.attributes?.data;
    if (!name || !eventData) continue;
    const key = pickKey(eventData);
    const createdAt = parseDate(item.attributes?.created);
    if (!key || !createdAt) continue;

    const cur = out.get(key) ?? {
      signedAt: null,
      viewedAt: null,
      refusedAt: null,
    };

    if (name === "sign") {
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

    out.set(key, cur);
  }
  return out;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve URL do PDF assinado em 2 etapas:
 * 1. Tenta extrair de `included` da resposta de getEnvelope (legacy v2)
 * 2. Fallback: chama `/api/v3/envelopes/{id}/documents` e procura
 *    `attributes.downloads.signed_file_url` no primeiro doc
 *
 * Necessário porque webhook v3 `document_closed` NÃO traz a URL no payload.
 */
async function resolveSignedUrl(
  clicksignId: string,
  envResp: unknown
): Promise<string | null> {
  // 1. Legacy v2: pode vir em getEnvelope(?include=documents)
  const fromIncluded = extractSignedUrl(envResp);
  if (fromIncluded) return fromIncluded;

  // 2. v3: lista documents → pra cada doc lista files → pega URL do
  //    PDF assinado. ClickSign v3 separa em 2 endpoints:
  //    /documents (metadata) e /documents/{id}/files (binários).
  try {
    const docs = await listEnvelopeDocuments(clicksignId);
    const docsData = (docs as { data?: unknown }).data;
    if (!Array.isArray(docsData)) return null;
    for (const doc of docsData as Array<{ id?: string }>) {
      if (!doc.id) continue;
      const filesResp = await listDocumentFiles(clicksignId, doc.id);
      const filesData = (filesResp as { data?: unknown }).data;
      if (!Array.isArray(filesData)) continue;
      // Procura primeiro o file marcado como signed/closed; cai pro
      // primeiro com URL caso a v3 não exponha o flag.
      for (const file of filesData as Array<{
        attributes?: {
          kind?: string;
          name?: string;
          url?: string;
          download_url?: string;
        };
      }>) {
        const kind = file.attributes?.kind ?? file.attributes?.name ?? "";
        const url = file.attributes?.url ?? file.attributes?.download_url;
        if (url && /sign|closed|finalized/i.test(kind)) return url;
      }
      // Fallback: primeiro arquivo com URL
      for (const file of filesData as Array<{
        attributes?: { url?: string; download_url?: string };
      }>) {
        const url = file.attributes?.url ?? file.attributes?.download_url;
        if (url) return url;
      }
    }
  } catch (err) {
    console.error("[envelope sync] falha resolveSignedUrl:", err);
  }
  return null;
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
