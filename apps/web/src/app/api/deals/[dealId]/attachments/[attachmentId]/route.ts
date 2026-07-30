import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

const patchSchema = z.object({
  // Reclassificação ("mover para outra pasta"): grava em
  // extractedData.assignment. kind = vendedor|comprador|imovel|outro (+
  // variantes conjuge/representante que groupKindOf normaliza no front).
  assignment: z
    .object({
      kind: z.string(),
      index: z.number().int().min(0),
    })
    .optional(),
  category: z.string().nullable().optional(),
});

/**
 * PATCH /api/deals/:dealId/attachments/:attachmentId
 *
 * Atualiza a classificação de um DealAttachment — move o documento entre
 * "pastas" (partes/imóvel) gravando extractedData.assignment, e/ou troca a
 * category. Merge não-destrutivo no extractedData existente.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string; attachmentId: string } }
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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    include: { deal: { select: { pipeline: { select: { orgId: true } } } } },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
  }
  if (attachment.dealId !== params.dealId) {
    return NextResponse.json(
      { error: "Anexo não pertence a este deal" },
      { status: 400 }
    );
  }
  if (attachment.deal.pipeline.orgId !== org.id) {
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

  const data: { extractedData?: object; category?: string | null } = {};
  if (parsed.data.assignment) {
    const current =
      (attachment.extractedData as Record<string, unknown> | null) ?? {};
    data.extractedData = { ...current, assignment: parsed.data.assignment };
  }
  if (parsed.data.category !== undefined) {
    data.category = parsed.data.category;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  await prisma.dealAttachment.update({
    where: { id: attachment.id },
    data,
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "ATTACHMENT_RECLASSIFY",
    result: "SUCCESS",
    resource: attachment.id,
    resourceType: "DealAttachment",
    metadata: {
      dealId: attachment.dealId,
      assignment: parsed.data.assignment ?? null,
      category: parsed.data.category ?? attachment.category,
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/deals/:dealId/attachments/:attachmentId
 *
 * Apaga um documento (DealAttachment) específico do negócio. Best-effort
 * deleta o blob no Vercel Blob/S3. CertidaoJob com FK para o attachment
 * recebe SET NULL via schema; Envelope de assinatura do anexo cai na cascata
 * (SET NULL violaria o CHECK envelope_subject_xor).
 *
 * Bloqueio: Envelope ClickSign closed/running → 409 (mesma regra do DELETE de
 * contrato). Cancele o envelope antes de excluir o documento.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { dealId: string; attachmentId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    include: {
      deal: {
        select: { id: true, pipeline: { select: { orgId: true } } },
      },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
  }
  if (attachment.dealId !== params.dealId) {
    return NextResponse.json(
      { error: "Anexo não pertence a este deal" },
      { status: 400 }
    );
  }
  if (attachment.deal.pipeline.orgId !== org.id) {
    return NextResponse.json(
      { error: "Forbidden", reason: "deal de outra organização" },
      { status: 403 }
    );
  }

  // Escopo do gerente + DEAL_EDIT (delete de documento da pasta).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  // Bloqueio: envelope ClickSign ativo. Sem isso a cascata levaria junto uma
  // assinatura em curso (ou o registro de uma já concluída).
  const blockingEnvelope = await prisma.envelope.findFirst({
    where: {
      attachmentId: attachment.id,
      status: { in: ["closed", "running"] },
    },
    select: { id: true, status: true },
  });
  if (blockingEnvelope) {
    return NextResponse.json(
      {
        error: `Este documento está em um envelope ClickSign ${blockingEnvelope.status === "closed" ? "concluído" : "em andamento"}. Cancele o envelope antes de excluir.`,
        envelopeId: blockingEnvelope.id,
      },
      { status: 409 }
    );
  }

  // Deleta a ROW primeiro; só então avalia se o blob ficou órfão. O blob é
  // compartilhado por referência (FormAttachment/ProposalAttachment/duplicatas
  // de DealAttachment apontam pra mesma URL) — apagar incondicionalmente órfãva
  // o arquivo das irmãs (bug: matrícula/IPTU davam 404). `deleteBlobIfUnreferenced`
  // só remove do storage quando nenhuma outra row referencia a URL.
  await prisma.dealAttachment.delete({ where: { id: attachment.id } });

  // Inline (não waitUntil) DE PROPÓSITO: quanto menor a janela entre a contagem
  // de referências e o delete no storage, menor a chance de um finalize de form
  // concorrente copiar a URL pra um DealAttachment novo bem no meio (TOCTOU).
  // Adiar pra waitUntil alargaria essa janela. O resíduo é raro e recuperável
  // (um anexo dá 404, re-upload resolve); o fix definitivo é um cron de GC de
  // órfãos com carência, no backlog.
  const { deleteBlobIfUnreferenced } = await import(
    "@/lib/contracts/delete-cleanup"
  );
  const blobOutcome = await deleteBlobIfUnreferenced(prisma, attachment.url);
  const blobDeleted = blobOutcome === "deleted";

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "ATTACHMENT_DELETE",
    result: "SUCCESS",
    resource: attachment.id,
    resourceType: "DealAttachment",
    metadata: {
      dealId: attachment.dealId,
      filename: attachment.filename,
      category: attachment.category,
      blobDeleted,
      blobOutcome,
    },
  });

  return NextResponse.json({ deleted: true });
}
