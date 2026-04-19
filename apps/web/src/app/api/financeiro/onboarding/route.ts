import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/financeiro/onboarding
 * Retorna status da subconta Asaas da org + próximo passo do wizard.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: ctx.orgId },
    include: {
      documents: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!account) {
    return NextResponse.json({
      status: "NOT_STARTED",
      nextStep: "CREATE_SUBACCOUNT",
    });
  }

  // Determine próximo passo
  let nextStep: string = "WAITING";
  if (account.status === "APPROVED") nextStep = "DONE";
  else if (account.status === "REJECTED") nextStep = "RESUBMIT";
  else if (account.status === "AWAITING_DOCS") nextStep = "UPLOAD_DOCS";
  else if (account.status === "AWAITING_APPROVAL") nextStep = "WAITING";
  else if (account.status === "PENDING") nextStep = "UPLOAD_DOCS";

  const docsPendingCount = account.documents.filter(
    (d) => d.status === "NOT_SENT" || d.status === "REJECTED"
  ).length;

  return NextResponse.json({
    status: account.status,
    nextStep,
    accountId: account.id,
    asaasId: account.asaasId,
    walletId: account.walletId,
    personType: account.personType,
    generalStatus: account.generalStatus,
    documentationStatus: account.documentationStatus,
    commercialInfoStatus: account.commercialInfoStatus,
    bankAccountInfoStatus: account.bankAccountInfoStatus,
    rejectionReason: account.rejectionReason,
    approvedAt: account.approvedAt,
    lastStatusCheckAt: account.lastStatusCheckAt,
    documents: account.documents.map((d) => ({
      id: d.id,
      asaasDocumentId: d.asaasDocumentId,
      type: d.type,
      title: d.title,
      description: d.description,
      status: d.status,
      fileName: d.fileName,
      fileMime: d.fileMime,
      fileSizeBytes: d.fileSizeBytes,
      uploadedAt: d.uploadedAt,
      reviewedAt: d.reviewedAt,
      rejectionReason: d.rejectionReason,
    })),
    docsPendingCount,
  });
}
