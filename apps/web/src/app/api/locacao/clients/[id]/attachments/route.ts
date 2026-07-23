import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { persistLeaseClientDocument } from "@/lib/locacao/client-attachments";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

async function assertClient(id: string, orgId: string) {
  const client = await prisma.leaseClient.findUnique({ where: { id } });
  return client && client.orgId === orgId ? client : null;
}

/** GET — lista os documentos do cliente. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_VIEW);
  if (isRouteError(ctx)) return ctx;
  if (!(await assertClient(params.id, ctx.orgId))) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  const attachments = await prisma.leaseClientAttachment.findMany({
    where: { leaseClientId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ attachments });
}

/** POST — upload multipart de um documento (dedupe por conteúdo). */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_UPDATE);
  if (isRouteError(ctx)) return ctx;
  if (!(await assertClient(params.id, ctx.orgId))) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente (campo 'file')" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo excede 20MB" }, { status: 413 });
  }
  const category = (form?.get("category") as string | null) || null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const url = await uploadBufferToStorage({
    bucket: process.env.S3_BUCKET,
    key: `client-docs/${params.id}/${safeName}`,
    body: buffer,
    contentType: file.type || "application/octet-stream",
  });

  const { attachment, deduped } = await persistLeaseClientDocument({
    leaseClientId: params.id,
    buffer,
    url,
    filename: file.name,
    mime: file.type || "application/octet-stream",
    category,
  });

  if (!deduped) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId },
      {
        action: "CLIENT_DOCUMENT_UPLOAD",
        result: "SUCCESS",
        resource: attachment.id,
        resourceType: "LeaseClientAttachment",
        metadata: { leaseClientId: params.id, mime: attachment.mime, bytes: buffer.byteLength },
      }
    );
  }

  return NextResponse.json({ attachment, deduped }, { status: deduped ? 200 : 201 });
}

/** DELETE — remove um documento (body ou query `attachmentId`). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_UPDATE);
  if (isRouteError(ctx)) return ctx;
  if (!(await assertClient(params.id, ctx.orgId))) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const attachmentId =
    new URL(req.url).searchParams.get("attachmentId") ??
    ((await req.json().catch(() => ({}))).attachmentId as string | undefined);
  if (!attachmentId) {
    return NextResponse.json({ error: "attachmentId ausente" }, { status: 400 });
  }

  const attachment = await prisma.leaseClientAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment || attachment.leaseClientId !== params.id) {
    return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  }

  await prisma.leaseClientAttachment.delete({ where: { id: attachmentId } });
  // Best-effort: remove do storage só se ninguém mais referencia (o blob pode ter
  // sido copiado por referência pra um DealAttachment na conversão da locação).
  const { deleteBlobIfUnreferenced } = await import(
    "@/lib/contracts/delete-cleanup"
  );
  await deleteBlobIfUnreferenced(prisma, attachment.url);

  return NextResponse.json({ ok: true });
}
