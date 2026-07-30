import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { archiveAttachment } from "@/lib/attachments/archive";

export const runtime = "nodejs";

/**
 * Categorias que o SISTEMA atribui e usa como chave de comportamento. O usuário
 * não pode mover um documento seu pra dentro delas.
 *
 * O caso concreto que isso fecha: `persistFormSummaryPdf` casava a linha do
 * resumo por `category = "resumo_formulario"`, então reclassificar um documento
 * qualquer pra essa categoria fazia o próximo envio de resumo apagá-lo. As
 * outras duas são gatilho de comportamento — `contrato_original` liga a
 * re-extração de dados do CCV, `proposta_original` o banner de proposta.
 */
const RESERVED_CATEGORIES = new Set([
  "resumo_formulario",
  "contrato_original",
  "proposta_original",
]);

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
  category: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || !RESERVED_CATEGORIES.has(v),
      "Categoria reservada ao sistema — escolha outra"
    ),
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
 * Remove um documento (DealAttachment) específico do negócio. NÃO é exclusão
 * definitiva: a linha vai pra `DeletedAttachment` (arquivo permanente) na mesma
 * transação, e o blob no storage é preservado — dá pra restaurar depois.
 * CertidaoJob com FK para o attachment recebe SET NULL via schema; Envelope de
 * assinatura do anexo cai na cascata (SET NULL violaria o CHECK
 * envelope_subject_xor).
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

  // Arquiva e apaga na MESMA transação: ou as duas coisas acontecem, ou
  // nenhuma. Não existe mais estado "documento sumiu e não há registro".
  //
  // O blob NÃO é mais tocado. Antes chamávamos `deleteBlobIfUnreferenced` aqui,
  // e o objeto ia embora junto com a última linha que o referenciava — foi o
  // que impediu recuperar o documento do caso que originou esta mudança.
  // `DeletedAttachment.url` entra em `BLOB_REF_CHECKS`, então nada trata o
  // objeto como órfão enquanto houver linha arquivada.
  const { deal: _deal, ...row } = attachment;
  const archivedId = await prisma.$transaction((tx) =>
    archiveAttachment(tx, {
      row,
      origin: "deal",
      via: "ui_deal",
      orgId: org.id,
      userId: session.user.id,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
    })
  );

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "ATTACHMENT_DELETE",
    result: "SUCCESS",
    resource: attachment.id,
    resourceType: "DealAttachment",
    metadata: {
      dealId: attachment.dealId,
      filename: attachment.filename,
      category: attachment.category,
      archivedId,
      recoverable: true,
    },
  });

  return NextResponse.json({ deleted: true, archivedId, recoverable: true });
}
