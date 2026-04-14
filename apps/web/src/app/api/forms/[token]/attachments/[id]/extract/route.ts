import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import { classifyAndExtract } from "@/lib/ai/ocr";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPPORTED_OCR_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

export async function POST(
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

  if (attachment.extractedData) {
    return NextResponse.json({
      cached: true,
      category: attachment.category,
      extractedData: attachment.extractedData,
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "OCR indisponivel: ANTHROPIC_API_KEY nao configurada" },
      { status: 503 }
    );
  }

  if (!SUPPORTED_OCR_MIMES.includes(attachment.mime)) {
    return NextResponse.json(
      { error: `Tipo nao suportado para OCR: ${attachment.mime}` },
      { status: 400 }
    );
  }

  try {
    const buffer = await downloadBufferFromUrl(attachment.url);
    const base64 = buffer.toString("base64");
    const result = await classifyAndExtract(base64, attachment.mime);

    const payload = {
      fields: result.fields,
      confidence: result.confidence,
    };

    await prisma.formAttachment.update({
      where: { id: attachment.id },
      data: {
        category: result.documentType,
        extractedData: payload as object,
      },
    });

    return NextResponse.json({
      cached: false,
      category: result.documentType,
      extractedData: payload,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[form extract] failed:", msg);
    return NextResponse.json({ error: `Falha na extracao: ${msg}` }, { status: 500 });
  }
}
