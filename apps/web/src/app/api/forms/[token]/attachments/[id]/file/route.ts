import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string; id: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: { id: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const attachment = await prisma.formAttachment.findUnique({
    where: { id: params.id },
  });
  if (!attachment || attachment.formId !== form.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  if (attachment.url.startsWith("https://")) {
    return NextResponse.redirect(attachment.url, 302);
  }

  try {
    const buffer = await downloadBufferFromUrl(attachment.url);
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": attachment.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Falha ao ler arquivo: ${msg}` }, { status: 500 });
  }
}
