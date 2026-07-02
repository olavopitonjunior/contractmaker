import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

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
      attachment: { select: { id: true, url: true, filename: true } },
    },
  });
  if (!job || job.dealId !== params.dealId || !job.deal) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!DELETABLE.includes(job.status)) {
    return NextResponse.json(
      {
        error: `Nao e possivel deletar jobs em andamento (${job.status}). Recupere travadas primeiro.`,
      },
      { status: 400 }
    );
  }

  let attachmentDeleted = false;
  if (withAttachment && job.attachment) {
    // Best-effort: remove o blob no Vercel Blob (mesma heurística do
    // endpoint de attachments). Falha no blob não bloqueia o delete da row.
    if (
      job.attachment.url &&
      job.attachment.url.includes(".public.blob.vercel-storage.com")
    ) {
      try {
        const { del } = await import("@vercel/blob");
        await del(job.attachment.url);
      } catch (err) {
        console.warn(
          "[certidao DELETE] falha ao remover blob:",
          err instanceof Error ? err.message : err
        );
      }
    }
    // CertidaoJob.attachmentId é SET NULL no schema, mas como vamos deletar o
    // job logo em seguida, deletar o anexo primeiro é seguro.
    await prisma.dealAttachment.delete({ where: { id: job.attachment.id } });
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
    },
  });

  return NextResponse.json({ ok: true, attachmentDeleted });
}
