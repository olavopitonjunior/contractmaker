import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * Documentos removidos de um negócio: listar (GET) e restaurar (POST).
 *
 * Existe porque exclusão de anexo deixou de ser destrutiva: a linha vai pra
 * `DeletedAttachment` e o blob no storage é preservado de propósito
 * (`DeletedAttachment.url` entra em BLOB_REF_CHECKS). Sem este endpoint o
 * arquivo seria só um registro de auditoria — aqui ele vira desfazer de fato.
 *
 * Só membro da org, e sempre escopado pelo deal da URL: `DeletedAttachment` não
 * tem FK pra Deal (ver o model), então o cross-org guard é feito à mão contra
 * `deal.pipeline.orgId`. Sem isso, o id de um arquivo de outra org restauraria
 * documento alheio dentro deste negócio.
 */

async function requireDealMember(req: NextRequest, dealId: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return { error: NextResponse.json({ error: "No organization" }, { status: 400 }) };
  }
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, pipeline: { select: { orgId: true } } },
  });
  if (!deal) {
    return { error: NextResponse.json({ error: "Deal não encontrado" }, { status: 404 }) };
  }
  if (deal.pipeline.orgId !== org.id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, org, deal };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const ctx = await requireDealMember(req, params.dealId);
  if ("error" in ctx) return ctx.error;

  const items = await prisma.deletedAttachment.findMany({
    where: { dealId: params.dealId, orgId: ctx.org.id },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      filename: true,
      category: true,
      origin: true,
      deletedVia: true,
      deletedAt: true,
      deletedByUserId: true,
    },
  });

  // `restored` marca o que já voltou: a linha do arquivo é mantida (histórico
  // imutável), então sem isto a UI ofereceria "restaurar" de novo pra algo que
  // já está na pasta e criaria duplicata.
  const originalIds = items.map((i) => i.id);
  const restored = originalIds.length
    ? await prisma.dealAttachment.findMany({
        where: { dealId: params.dealId, restoredFromId: { in: originalIds } },
        select: { restoredFromId: true },
      })
    : [];
  const restoredSet = new Set(restored.map((r) => r.restoredFromId));

  return NextResponse.json({
    items: items.map((i) => ({ ...i, restored: restoredSet.has(i.id) })),
  });
}

const postSchema = z.object({ archivedId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const ctx = await requireDealMember(req, params.dealId);
  if ("error" in ctx) return ctx.error;

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const archived = await prisma.deletedAttachment.findUnique({
    where: { id: parsed.data.archivedId },
  });
  if (!archived) {
    return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  }
  // Escopo à mão — ver o doc-block: sem FK, o id sozinho não prova nada.
  if (archived.orgId !== ctx.org.id || archived.dealId !== params.dealId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const already = await prisma.dealAttachment.findFirst({
    where: { dealId: params.dealId, restoredFromId: archived.id },
    select: { id: true },
  });
  if (already) {
    return NextResponse.json(
      { error: "Este documento já foi restaurado", attachmentId: already.id },
      { status: 409 }
    );
  }

  const payload = (archived.payload ?? {}) as Record<string, unknown>;
  const str = (k: string): string | null =>
    typeof payload[k] === "string" ? (payload[k] as string) : null;

  const restored = await prisma.dealAttachment.create({
    data: {
      dealId: params.dealId,
      filename: archived.filename,
      // Campos reconstruídos do payload, não do schema atual: a linha pode ter
      // sido arquivada antes de uma coluna existir.
      mime: str("mime") ?? "application/octet-stream",
      url: archived.url,
      category: archived.category,
      source: str("source") ?? "manual",
      extractedData:
        payload.extractedData && typeof payload.extractedData === "object"
          ? (payload.extractedData as Prisma.InputJsonValue)
          : undefined,
      contentHash: str("contentHash"),
      byteSize:
        typeof payload.byteSize === "number" ? (payload.byteSize as number) : null,
      restoredFromId: archived.id,
    },
    select: { id: true, filename: true },
  });

  await audit(
    extractAuditContextFromRequest(req, ctx.org.id, ctx.session.user.id),
    {
      action: "ATTACHMENT_RESTORE",
      result: "SUCCESS",
      resource: restored.id,
      resourceType: "DealAttachment",
      metadata: {
        dealId: params.dealId,
        archivedId: archived.id,
        originalId: archived.originalId,
        filename: archived.filename,
        deletedAt: archived.deletedAt.toISOString(),
        deletedVia: archived.deletedVia,
      },
    }
  );

  return NextResponse.json({ restored });
}
