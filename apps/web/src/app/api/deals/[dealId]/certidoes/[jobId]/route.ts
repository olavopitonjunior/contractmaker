import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { archiveAttachment } from "@/lib/attachments/archive";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

/**
 * GET /api/deals/:dealId/certidoes/:jobId
 *
 * Status de UM CertidaoJob (Bearer `documents:r` ou session). Newton usa pra
 * acompanhar um job específico após o dispatch (two-step awaiting_portal etc.)
 * sem puxar a batch inteira. Sem `resultData` cru — payload enxuto.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string; jobId: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "documents:r" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const job = await prisma.certidaoJob.findUnique({
    where: { id: params.jobId },
    include: {
      deal: { include: { pipeline: { select: { orgId: true } } } },
      attachment: { select: { id: true, filename: true, mime: true } },
    },
  });
  if (!job || job.dealId !== params.dealId || !job.deal) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.deal.pipeline.orgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente (GET do job traz payload/resultado com PII).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
  });
  if (denied) return denied;

  return NextResponse.json({
    job: {
      id: job.id,
      batchId: job.batchId,
      endpoint: job.endpoint,
      label: job.label,
      targetKind: job.targetKind,
      targetIndex: job.targetIndex,
      status: job.status,
      resultCode: job.resultCode,
      errorMessage: job.errorMessage,
      missingFields: job.missingFields,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      portalUrl: job.portalUrl,
      costCents: job.costCents,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      expectedReadyAt: job.expectedReadyAt,
      nextRetryAt: job.nextRetryAt,
      attachment: job.attachment,
    },
  });
}

// Estados terminais que podem ser deletados. Só `pending`/`fetching` ficam de
// fora — esses precisam ser recuperados (sweep) antes, senão deletamos um job
// que o executor ainda está escrevendo.
const DELETABLE = [
  "success",
  "failed",
  "failed_permanent",
  "skipped",
  "data_missing",
  "data_invalid",
  "informativo",
  "awaiting_portal",
  "duplicate_pending",
  "replaced",
];

/**
 * DELETE /api/deals/:dealId/certidoes/:jobId[?withAttachment=true]
 *
 * Deletes a single CertidaoJob in any terminal state. In-progress jobs
 * (pending/fetching) must be swept first.
 *
 * Por padrão o DealAttachment (PDF) ligado ao job NÃO é apagado — o documento
 * persiste na pasta mesmo sem o job. Com `?withAttachment=true`, removemos
 * também o anexo (best-effort no blob + row), espelhando a lógica de
 * /api/deals/[dealId]/attachments/[attachmentId].
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { dealId: string; jobId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const withAttachment =
    new URL(req.url).searchParams.get("withAttachment") === "true";

  const job = await prisma.certidaoJob.findUnique({
    where: { id: params.jobId },
    include: {
      deal: {
        include: {
          form: { select: { orgId: true } },
          // org via pipeline (form pode ser null em deal formless — IDOR)
          pipeline: { select: { orgId: true } },
        },
      },
      // Linha inteira (não um select parcial): `archiveAttachment` grava o
      // payload completo pra permitir restaurar depois.
      attachment: true,
    },
  });
  if (!job || job.dealId !== params.dealId || !job.deal) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + DEAL_EDIT.
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  if (!DELETABLE.includes(job.status)) {
    return NextResponse.json(
      {
        error: `Nao e possivel deletar jobs em andamento (${job.status}). Recupere travadas primeiro.`,
      },
      { status: 400 }
    );
  }

  let attachmentDeleted = false;
  let archivedId: string | null = null;
  if (withAttachment && job.attachment) {
    // O `del()` incondicional que existia aqui era um bug: o blob é
    // COMPARTILHADO por referência (o finalize do form copia a URL sem
    // re-upload, e o PDF assinado é espelhado com a mesma URL em
    // lib/clicksign/signed-pdf.ts), então apagar o objeto derrubava documentos
    // de outras linhas vivas — o sintoma "documento sumiu" com a linha intacta.
    // Hoje nenhum caminho apaga blob: a linha é arquivada e o objeto fica.
    //
    // CertidaoJob.attachmentId é SET NULL no schema, mas como o job é apagado
    // logo em seguida, arquivar o anexo primeiro é seguro.
    archivedId = await prisma.$transaction((tx) =>
      archiveAttachment(tx, {
        row: job.attachment!,
        origin: "deal",
        via: "certidao",
        orgId: org.id,
        userId: session.user.id,
        ipAddress: req.headers.get("x-forwarded-for") ?? null,
      })
    );
    attachmentDeleted = true;
  }

  await prisma.certidaoJob.delete({ where: { id: params.jobId } });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "CERTIDAO_JOB_DELETE",
    result: "SUCCESS",
    resource: params.jobId,
    resourceType: "CertidaoJob",
    metadata: {
      dealId: params.dealId,
      endpoint: job.endpoint,
      status: job.status,
      attachmentDeleted,
      archivedId,
    },
  });

  // `ATTACHMENT_DELETE` separado: sem isto, uma busca no AuditLog por exclusão
  // de anexo não encontrava nada desta rota — o rastro ficava escondido atrás
  // de uma ação de certidão.
  if (archivedId && job.attachment) {
    await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
      action: "ATTACHMENT_DELETE",
      result: "SUCCESS",
      resource: job.attachment.id,
      resourceType: "DealAttachment",
      metadata: {
        dealId: params.dealId,
        filename: job.attachment.filename,
        via: "certidao",
        archivedId,
        recoverable: true,
      },
    });
  }

  return NextResponse.json({ ok: true, attachmentDeleted, archivedId });
}
