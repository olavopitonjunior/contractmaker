import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { isInspectionContentEditable } from "@/lib/locacao/inspection-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_EXECUTE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const inspection = await prisma.inspection.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!inspection) {
    return NextResponse.json({ error: "Vistoria não encontrada" }, { status: 404 });
  }
  if (!isInspectionContentEditable(inspection.status)) {
    return NextResponse.json(
      { error: `Laudo em "${inspection.status}" não recebe fotos.` },
      { status: 422 }
    );
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Tipo inválido: ${file.type}. Permitidos: JPEG, PNG, WebP.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Arquivo excede 5 MB" }, { status: 400 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN não configurado — upload indisponível." },
      { status: 503 }
    );
  }

  const ext = (file.name || "foto").split(".").pop()?.toLowerCase() || "jpg";
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const blob = await put(`inspections/${id}/${safeName}`, file, {
      access: "public",
      contentType: file.type,
      token,
    });
    return NextResponse.json({ url: blob.url, size: file.size, type: file.type });
  } catch (err) {
    console.error("[inspection photo upload]", err);
    return NextResponse.json({ error: "Falha no upload" }, { status: 500 });
  }
}
