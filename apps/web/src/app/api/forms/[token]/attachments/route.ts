import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const attachments = await prisma.formAttachment.findMany({
    where: { formId: form.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      category: a.category,
      extractedData: a.extractedData,
      fileUrl: `/api/forms/${params.token}/attachments/${a.id}/file`,
      createdAt: a.createdAt,
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Arquivo excede o limite de 10 MB" },
      { status: 400 }
    );
  }

  if (!ALLOWED_MIMES.includes(file.type)) {
    return NextResponse.json(
      { error: `Tipo de arquivo nao suportado: ${file.type}` },
      { status: 400 }
    );
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN nao configurado — upload indisponivel" },
      { status: 503 }
    );
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const pathname = `form-attachments/${form.id}/${Date.now()}-${safeName}`;

  try {
    const blob = await put(pathname, file, {
      access: "public",
      contentType: file.type,
      token: blobToken,
    });

    const attachment = await prisma.formAttachment.create({
      data: {
        formId: form.id,
        filename: file.name,
        mime: file.type,
        url: blob.url,
        category: null,
        extractedData: undefined,
      },
    });

    return NextResponse.json({
      id: attachment.id,
      filename: attachment.filename,
      mime: attachment.mime,
      fileUrl: `/api/forms/${params.token}/attachments/${attachment.id}/file`,
      createdAt: attachment.createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[form attachment upload]", msg);
    return NextResponse.json(
      { error: `Falha no upload: ${msg}` },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });
  }

  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const attachment = await prisma.formAttachment.findUnique({ where: { id } });
  if (!attachment || attachment.formId !== form.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const assignment = body?.assignment;
  if (!assignment || typeof assignment !== "object") {
    return NextResponse.json({ error: "assignment obrigatorio" }, { status: 400 });
  }

  const current = (attachment.extractedData as Record<string, unknown>) || {};
  const next = { ...current, assignment };

  const updated = await prisma.formAttachment.update({
    where: { id },
    data: { extractedData: next as object },
  });

  return NextResponse.json({
    id: updated.id,
    extractedData: updated.extractedData,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });
  }

  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const attachment = await prisma.formAttachment.findUnique({
    where: { id },
  });
  if (!attachment || attachment.formId !== form.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken && attachment.url.startsWith("https://")) {
    try {
      await del(attachment.url, { token: blobToken });
    } catch (err) {
      console.warn("[form attachment delete blob]", err);
    }
  }

  await prisma.formAttachment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
