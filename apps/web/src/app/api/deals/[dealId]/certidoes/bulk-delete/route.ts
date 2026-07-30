import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { bulkDeleteSchema, buildBulkDeleteWhere } from "@/lib/certidoes/bulk-delete";
import { archiveAttachment } from "@/lib/attachments/archive";

export const runtime = "nodejs";

/**
 * POST /api/deals/:dealId/certidoes/bulk-delete
 *
 * Apaga em massa jobs terminais do deal conforme o escopo. Com
 * `withAttachments`, remove também os DealAttachment (blob + row) ligados.
 * `dryRun` retorna a contagem sem apagar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      form: { select: { orgId: true } },
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const built = buildBulkDeleteWhere(parsed.data);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  const where: Prisma.CertidaoJobWhereInput = {
    dealId: params.dealId,
    ...built.where,
  };

  const candidates = await prisma.certidaoJob.findMany({
    where,
    select: { id: true, attachmentId: true },
  });

  if (parsed.data.dryRun) {
    return NextResponse.json({
      mode: "dry-run",
      count: candidates.length,
      withAttachments: !!parsed.data.withAttachments,
    });
  }

  if (candidates.length === 0) {
    return NextResponse.json({ deleted: 0, attachmentsDeleted: 0 });
  }

  let attachmentsDeleted = 0;
  const archivedIds: string[] = [];
  if (parsed.data.withAttachments) {
    const attachmentIds = candidates
      .map((c) => c.attachmentId)
      .filter((id): id is string => !!id);
    if (attachmentIds.length > 0) {
      // Linha inteira: `archiveAttachment` grava o payload completo.
      const attachments = await prisma.dealAttachment.findMany({
        where: { id: { in: attachmentIds }, dealId: params.dealId },
      });
      // O `del()` incondicional que existia aqui apagava blob COMPARTILHADO
      // (o finalize copia a URL sem re-upload; o PDF assinado é espelhado com a
      // mesma URL), derrubando documentos de outras linhas vivas. Nenhum
      // caminho apaga blob hoje: arquiva a linha e o objeto fica de pé.
      const ip = req.headers.get("x-forwarded-for") ?? null;
      for (const att of attachments) {
        const archivedId = await prisma.$transaction((tx) =>
          archiveAttachment(tx, {
            row: att,
            origin: "deal",
            via: "certidao",
            orgId: org.id,
            userId: session.user.id,
            ipAddress: ip,
          })
        );
        archivedIds.push(archivedId);
      }
      attachmentsDeleted = attachments.length;
    }
  }

  const deleted = await prisma.certidaoJob.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "CERTIDAO_BULK_DELETE",
    result: "SUCCESS",
    resource: params.dealId,
    resourceType: "Deal",
    metadata: {
      scope: parsed.data.scope,
      status: parsed.data.status ?? null,
      batchId: parsed.data.batchId ?? null,
      deleted: deleted.count,
      attachmentsDeleted,
      // Ids nomeados, não só a contagem: corte silencioso lê como "nada
      // aconteceu" quando alguém for investigar um documento faltando.
      archivedIds,
    },
  });

  if (archivedIds.length > 0) {
    // Ação dedicada — busca no AuditLog por exclusão de anexo precisa achar
    // esta rota, não só a ação de certidão.
    await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
      action: "ATTACHMENT_DELETE",
      result: "SUCCESS",
      resource: params.dealId,
      resourceType: "DealAttachment",
      metadata: {
        dealId: params.dealId,
        via: "certidao_bulk",
        count: archivedIds.length,
        archivedIds,
        recoverable: true,
      },
    });
  }

  return NextResponse.json({
    deleted: deleted.count,
    attachmentsDeleted,
    archivedIds,
  });
}
