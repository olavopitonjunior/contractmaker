import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import {
  getEnvelope,
  listEnvelopeDocuments,
  listEnvelopeEvents,
  listEnvelopeRequirements,
  listEnvelopeSigners,
} from "./envelopes";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { autoPromoteDealOnContractSigned } from "@/lib/contracts/auto-promote-signed";
import { safeFetch } from "@/lib/security/ssrf";

/**
 * Reconcilia o estado de UM envelope com a ClickSign v3 — fonte canônica de
 * quem assinou é `/events`. Compartilhado pelas rotas de sync de contrato e
 * de deal (documento avulso); cada rota carrega+guarda o envelope e delega.
 *
 * Idempotente: só grava quando o estado remoto difere do local. Em close,
 * baixa o PDF assinado e (se for contrato) auto-promove o stage do deal.
 */
export type EnvelopeWithSigners = Prisma.EnvelopeGetPayload<{
  include: { signers: true };
}>;

export interface SyncResult {
  ok: true;
  signersUpdated: number;
  envelopeUpdated: boolean;
  dealStagePromoted: boolean;
  remoteStatus: string | undefined;
  debug?: Record<string, unknown>;
}

export async function syncEnvelopeState(
  envelope: EnvelopeWithSigners,
  opts: { actorVia: string; debug?: boolean }
): Promise<SyncResult> {
  if (!envelope.clicksignId) {
    throw new EnvelopeNotSyncableError();
  }

  const [envResp, signersResp, requirementsResp, eventsResp, documentsResp] =
    await Promise.all([
      getEnvelope(envelope.clicksignId),
      listEnvelopeSigners(envelope.clicksignId),
      listEnvelopeRequirements(envelope.clicksignId),
      listEnvelopeEvents(envelope.clicksignId).catch(() => null),
      listEnvelopeDocuments(envelope.clicksignId).catch(() => null),
    ]);

  const remoteStatus = (
    envResp as { data?: { attributes?: { status?: string } } }
  ).data?.attributes?.status;

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
      if (!local.refusedAt || +remote.refusedAt !== +local.refusedAt) {
        updates.refusedAt = remote.refusedAt;
      }
    } else if (remote.signedAt) {
      if (local.status !== "signed") updates.status = "signed";
      if (!local.signedAt || +remote.signedAt !== +local.signedAt) {
        updates.signedAt = remote.signedAt;
      }
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
  let dealStagePromoted = false;
  if (remoteStatus === "closed" && envelope.status !== "closed") {
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: { status: "closed", closedAt: new Date() },
    });
    const signedUrl = await resolveSignedUrl(envelope.clicksignId, envResp);
    if (signedUrl) waitUntil(downloadSignedPdf(envelope.id, signedUrl));
    envelopeUpdated = true;
    const promote = await autoPromoteDealOnContractSigned(envelope.id);
    dealStagePromoted = promote.promoted;
  } else if (remoteStatus === "canceled" && envelope.status !== "canceled") {
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: { status: "canceled", canceledAt: new Date() },
    });
    envelopeUpdated = true;
  } else if (remoteStatus === "closed" && envelope.status === "closed") {
    const promote = await autoPromoteDealOnContractSigned(envelope.id);
    if (promote.promoted) {
      dealStagePromoted = true;
      envelopeUpdated = true;
    }
  }

  if (
    remoteStatus === "closed" &&
    envelope.status === "closed" &&
    !envelope.signedDocumentUrl
  ) {
    const signedUrl = await resolveSignedUrl(envelope.clicksignId, envResp);
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
          actorVia: opts.actorVia,
        } as unknown as Prisma.InputJsonValue,
        source: "manual",
      },
    });
  }

  return {
    ok: true,
    signersUpdated,
    envelopeUpdated,
    dealStagePromoted,
    remoteStatus,
    ...(opts.debug && {
      debug: {
        envelopeRaw: envResp,
        signersRaw: signersResp,
        requirementsRaw: requirementsResp,
        eventsRaw: eventsResp,
        documentsRaw: documentsResp,
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
  };
}

export class EnvelopeNotSyncableError extends Error {
  constructor() {
    super("Envelope ainda não tem ID na ClickSign");
    this.name = "EnvelopeNotSyncableError";
  }
}

interface SignerEventState {
  signedAt: Date | null;
  viewedAt: Date | null;
  refusedAt: Date | null;
}

function aggregateEventsBySigner(resp: unknown): Map<string, SignerEventState> {
  return aggregateEventsBy(resp, (e) => e.signer?.key);
}

function aggregateEventsByEmail(resp: unknown): Map<string, SignerEventState> {
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
      if (!cur.signedAt || +createdAt < +cur.signedAt) cur.signedAt = createdAt;
    } else if (name === "signature_started") {
      if (!cur.viewedAt || +createdAt < +cur.viewedAt) cur.viewedAt = createdAt;
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

async function resolveSignedUrl(
  clicksignId: string,
  envResp: unknown
): Promise<string | null> {
  const fromIncluded = extractSignedUrl(envResp);
  if (fromIncluded) return fromIncluded;

  try {
    const docs = await listEnvelopeDocuments(clicksignId);
    const docsData = (docs as { data?: unknown }).data;
    if (!Array.isArray(docsData)) return null;
    for (const doc of docsData as Array<{
      links?: { files?: { signed?: string; original?: string } };
    }>) {
      const signedUrl = doc.links?.files?.signed;
      if (signedUrl) return signedUrl;
      const originalUrl = doc.links?.files?.original;
      if (originalUrl) return originalUrl;
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
    // SSRF guard: a URL vem do payload/da API ClickSign. safeFetch revalida o
    // host (e cada redirect) pra impedir fetch de IMDS/rede interna.
    const res = await safeFetch(url);
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
          env.source === "attachment"
            ? "documento_assinado"
            : "contrato_assinado";
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
