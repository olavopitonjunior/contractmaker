import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";
import { getMyAccountStatus, listMyAccountDocuments } from "@/lib/asaas/kyc";

/**
 * GET /api/public/kyc/[token]
 *
 * Endpoint público (sem auth) que retorna o estado da subconta Asaas pra
 * página de KYC hospedada em /kyc/[token]. Token é gerado na criação da
 * subconta (256 bits de entropia, único por conta).
 *
 * Retorna nome da titular + lista de slots de docs (com status atualizado
 * do Asaas, sincronizado em cada GET).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const account = await prisma.asaasAccount.findUnique({
    where: { kycToken: token },
    select: {
      id: true,
      asaasId: true,
      label: true,
      status: true,
      personType: true,
      kyc: true,
      apiKeyEncrypted: true,
      apiKeyIvBase64: true,
      apiKeyTagBase64: true,
      generalStatus: true,
      documentationStatus: true,
      approvedAt: true,
    },
  });
  if (!account) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }

  const kyc = (account.kyc ?? {}) as { name?: string; email?: string };
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  let status = account.status;
  let documentationStatus = account.documentationStatus ?? null;
  let generalStatus = account.generalStatus ?? null;
  let approvedAt = account.approvedAt;

  try {
    const liveStatus = await getMyAccountStatus({ apiKey });
    documentationStatus = liveStatus.documentation ?? documentationStatus;
    generalStatus = liveStatus.general ?? generalStatus;
    if (liveStatus.general === "APPROVED") {
      approvedAt = approvedAt ?? new Date();
      status = "APPROVED";
    }
  } catch {
    // não bloqueia a página por falha temporária de status
  }

  let docs: Array<{
    asaasDocumentId: string;
    type: string;
    title: string;
    description: string | null;
    status: string;
    fileName?: string | null;
  }> = [];
  try {
    const docsRes = await listMyAccountDocuments({ apiKey });
    docs = (docsRes.data ?? []).map((slot) => ({
      asaasDocumentId: slot.id,
      type: slot.type,
      title: slot.title ?? slot.type,
      description: slot.description ?? null,
      status: (slot.status ?? "NOT_SENT").toUpperCase(),
    }));
  } catch {
    docs = [];
  }

  // Refresh local mirror — opcional, best-effort.
  try {
    await prisma.asaasAccount.update({
      where: { id: account.id },
      data: {
        documentationStatus,
        generalStatus,
        lastStatusCheckAt: new Date(),
        approvedAt: approvedAt ?? undefined,
        status,
      },
    });
  } catch {}

  return NextResponse.json({
    accountId: account.id,
    name: kyc.name ?? account.label ?? "Subconta",
    personType: account.personType,
    status,
    documentationStatus,
    generalStatus,
    approvedAt: approvedAt ?? null,
    docs,
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
