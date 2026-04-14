import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  // Verify contract belongs to the org and is editable
  const contract = await prisma.contract.findFirst({
    where: { id: params.id },
    include: { template: true },
  });
  if (!contract || contract.template.orgId !== org.id) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado não pode receber imagens" },
      { status: 403 }
    );
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Tipo inválido: ${file.type}. Permitidos: ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Arquivo excede 5 MB` },
      { status: 400 }
    );
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "BLOB_READ_WRITE_TOKEN não configurado — upload de imagens indisponível. Use URL externa.",
      },
      { status: 503 }
    );
  }

  // Sanitize filename
  const originalName = file.name || "image";
  const ext = originalName.split(".").pop()?.toLowerCase() || "png";
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const pathname = `contracts/${params.id}/images/${safeName}`;

  try {
    const blob = await put(pathname, file, {
      access: "public",
      contentType: file.type,
      token,
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    console.error("[image upload]", err);
    return NextResponse.json({ error: "Falha no upload" }, { status: 500 });
  }
}
