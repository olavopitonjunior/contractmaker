import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { uploadBufferToStorage } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSURANCE_MANAGE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const policy = await prisma.insurancePolicy.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!policy) {
    return NextResponse.json({ error: "Apólice não encontrada" }, { status: 404 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Arquivo excede 10 MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Magic byte %PDF — content-type sozinho é falsificável (memória certidoes_attach_emitspdf_gate).
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "Arquivo não é um PDF válido" }, { status: 400 });
  }

  const url = await uploadBufferToStorage({
    key: `insurance/${id}/apolice-${Date.now()}.pdf`,
    body: buffer,
    contentType: "application/pdf",
  });

  const updated = await prisma.insurancePolicy.update({
    where: { id },
    data: { pdfUrl: url },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSURANCE_PDF_UPLOAD",
      result: "SUCCESS",
      resource: id,
      resourceType: "InsurancePolicy",
      metadata: { size: file.size },
    }
  );

  return NextResponse.json({ policy: updated, url });
}
