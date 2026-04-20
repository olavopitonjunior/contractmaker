import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  requireElevation,
  ElevationRequiredError,
} from "@/lib/security/elevation";
import { decryptSecret } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import { AsaasError } from "@/lib/asaas/errors";
import { uploadMyAccountDocument } from "@/lib/asaas/kyc";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/financeiro/onboarding/documents/[id]/upload
 * Multipart form with `file` field. Envia para Asaas + persiste local.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id: documentRowId } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.KYC_UPLOAD_DOCUMENT,
    });
    await requireElevation(ctx.userId, "KYC_EDIT");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const doc = await prisma.asaasAccountDocument.findFirst({
    where: { id: documentRowId },
    include: { account: true },
  });
  if (!doc || doc.account.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  }
  if (doc.status === "APPROVED") {
    return NextResponse.json(
      { error: "Documento já aprovado" },
      { status: 409 }
    );
  }

  // Parse multipart
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Envie o arquivo no campo 'file'" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Arquivo muito grande (max 10 MB, recebeu ${Math.round(file.size / 1024)} KB)` },
      { status: 413 }
    );
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json(
      { error: `Tipo não suportado: ${file.type}. Use JPG, PNG, WebP ou PDF` },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const apiKey = decryptSecret({
    ciphertext: doc.account.apiKeyEncrypted,
    iv: doc.account.apiKeyIvBase64,
    tag: doc.account.apiKeyTagBase64,
  });

  try {
    const uploadRes = await uploadMyAccountDocument({
      documentId: doc.asaasDocumentId,
      file: buffer,
      filename: file.name,
      mimeType: file.type,
      apiKey,
    });

    const updated = await prisma.asaasAccountDocument.update({
      where: { id: doc.id },
      data: {
        status: "PENDING",
        fileName: file.name,
        fileMime: file.type,
        fileSizeBytes: file.size,
        uploadedAt: new Date(),
        rejectionReason: null,
      },
    });

    // Se todos os docs estiverem enviados, muda account para AWAITING_APPROVAL
    const allDocs = await prisma.asaasAccountDocument.findMany({
      where: { accountId: doc.accountId },
    });
    const allSent = allDocs.every((d) => d.status === "PENDING" || d.status === "APPROVED");
    if (allSent) {
      await prisma.asaasAccount.update({
        where: { id: doc.accountId },
        data: { status: "AWAITING_APPROVAL" },
      });
    }

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "KYC_DOC_UPLOAD",
        result: "SUCCESS",
        resourceType: "asaas_account_document",
        resource: `asaas_account_document:${doc.id}`,
        metadata: { type: doc.type, size: file.size },
      }
    );

    return NextResponse.json({
      document: {
        id: updated.id,
        status: updated.status,
        fileName: updated.fileName,
        uploadedAt: updated.uploadedAt,
      },
      accountStatus: allSent ? "AWAITING_APPROVAL" : doc.account.status,
      asaasResponse: uploadRes,
    });
  } catch (err) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "KYC_DOC_UPLOAD",
        result: "FAILURE",
        metadata: { docType: doc.type, error: err instanceof Error ? err.message : "unknown" },
      }
    );
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors },
        { status: 422 }
      );
    }
    console.error("[kyc/upload]", err);
    return NextResponse.json(
      { error: "Falha no upload" },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
