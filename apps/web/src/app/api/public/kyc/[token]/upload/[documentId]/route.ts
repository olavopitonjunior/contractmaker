import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";
import { uploadMyAccountDocument } from "@/lib/asaas/kyc";
import { AsaasError } from "@/lib/asaas/errors";
import { audit } from "@/lib/security/audit";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * POST /api/public/kyc/[token]/upload/[documentId]
 *
 * Endpoint público (sem auth) — recebe upload de um slot KYC pela página
 * hospedada /kyc/[token]. Valida token + mime + tamanho e proxia o upload
 * pra Asaas usando a apiKey criptografada da subconta.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; documentId: string }> }
) {
  const { token, documentId } = await params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const account = await prisma.asaasAccount.findUnique({
    where: { kycToken: token },
    select: {
      id: true,
      orgId: true,
      asaasId: true,
      status: true,
      apiKeyEncrypted: true,
      apiKeyIvBase64: true,
      apiKeyTagBase64: true,
    },
  });
  if (!account) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }
  if (account.status === "APPROVED") {
    return NextResponse.json(
      { error: "Subconta já aprovada — uploads bloqueados" },
      { status: 422 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Campo 'file' ausente ou inválido" },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "Arquivo maior que 10 MB" },
      { status: 413 }
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "Formato não suportado — use JPG, PNG, WebP ou PDF" },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    const uploadResult = await uploadMyAccountDocument({
      documentId,
      file: buffer,
      filename: file.name,
      mimeType: file.type,
      apiKey,
    });

    // Mirror local — best-effort. AsaasAccountDocument unique é (accountId,type),
    // mas o asaasDocumentId é o que vem do Asaas; atualizamos by id local.
    try {
      const existing = await prisma.asaasAccountDocument.findFirst({
        where: { accountId: account.id, asaasDocumentId: documentId },
      });
      if (existing) {
        await prisma.asaasAccountDocument.update({
          where: { id: existing.id },
          data: {
            status: "PENDING",
            fileName: file.name,
            fileMime: file.type,
            fileSizeBytes: file.size,
            uploadedAt: new Date(),
          },
        });
      }
    } catch {}

    await audit(
      {
        orgId: account.orgId,
        userId: null,
        ipAddress:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
      {
        action: "KYC_DOC_UPLOAD",
        result: "SUCCESS",
        resourceType: "asaas_account",
        resource: `asaas_account:${account.id}`,
        metadata: {
          via: "public_kyc_token",
          asaasDocumentId: documentId,
          fileName: file.name,
        },
      }
    );

    return NextResponse.json({
      ok: true,
      uploadStatus: uploadResult.status,
    });
  } catch (err) {
    const message =
      err instanceof AsaasError
        ? err.errors?.[0]?.description ?? err.message
        : err instanceof Error
          ? err.message
          : "Falha no upload";
    return NextResponse.json(
      { error: "UPLOAD_FAILED", message },
      { status: 502 }
    );
  }
}

export const runtime = "nodejs";
