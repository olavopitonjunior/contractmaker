import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { AsaasError } from "@/lib/asaas/errors";
import {
  getMyAccountStatus,
  listMyAccountDocuments,
} from "@/lib/asaas/kyc";
import { getAccountWithApiKey } from "@/lib/asaas/account";

/**
 * POST /api/financeiro/onboarding/refresh?accountId=
 * Faz pull do status atual da subconta + atualiza docs.
 * Multi-account: aceita ?accountId= explícito; default = primeira conta da org.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const accountIdHint = url.searchParams.get("accountId");
  const account = accountIdHint
    ? await prisma.asaasAccount.findFirst({
        where: { id: accountIdHint, orgId: ctx.orgId },
      })
    : await prisma.asaasAccount.findFirst({
        where: { orgId: ctx.orgId },
        orderBy: { createdAt: "asc" },
      });
  if (!account) {
    return NextResponse.json(
      { error: "Subconta não encontrada" },
      { status: 404 }
    );
  }

  const { apiKey } = await getAccountWithApiKey(account.id);

  try {
    const [statusRes, docsRes] = await Promise.all([
      getMyAccountStatus({ apiKey }).catch((e) => {
        console.warn("[refresh] status falhou:", e instanceof Error ? e.message : e);
        return null;
      }),
      listMyAccountDocuments({ apiKey }).catch((e) => {
        console.warn("[refresh] listDocs falhou:", e instanceof Error ? e.message : e);
        return null;
      }),
    ]);

    // Determina status interno a partir do general
    let newStatus = account.status;
    if (statusRes?.general) {
      const g = statusRes.general.toUpperCase();
      if (g === "APPROVED") newStatus = "APPROVED";
      else if (g === "REJECTED") newStatus = "REJECTED";
      else if (g === "AWAITING_APPROVAL") newStatus = "AWAITING_APPROVAL";
      else if (g === "PENDING") {
        // Se doc ainda pendente, mantém AWAITING_DOCS
        if (statusRes.documentation === "PENDING") newStatus = "AWAITING_DOCS";
        else newStatus = "PENDING";
      }
    }

    await prisma.asaasAccount.update({
      where: { id: account.id },
      data: {
        status: newStatus,
        generalStatus: statusRes?.general ?? account.generalStatus,
        documentationStatus: statusRes?.documentation ?? account.documentationStatus,
        commercialInfoStatus: statusRes?.commercialInfo ?? account.commercialInfoStatus,
        bankAccountInfoStatus: statusRes?.bankAccountInfo ?? account.bankAccountInfoStatus,
        rejectionReason: statusRes?.rejectReasonDescriptions ?? account.rejectionReason,
        lastStatusCheckAt: new Date(),
        approvedAt: newStatus === "APPROVED" && !account.approvedAt ? new Date() : account.approvedAt,
      },
    });

    // Sync documents
    if (docsRes?.data) {
      for (const slot of docsRes.data) {
        await prisma.asaasAccountDocument.upsert({
          where: {
            accountId_type: {
              accountId: account.id,
              type: slot.type,
            },
          },
          create: {
            accountId: account.id,
            asaasDocumentId: slot.id,
            type: slot.type,
            title: slot.title ?? slot.type,
            description: slot.description ?? null,
            status: mapDocSlotStatus(slot.status),
            rejectionReason: slot.rejectReasonDescriptions ?? null,
          },
          update: {
            asaasDocumentId: slot.id,
            status: mapDocSlotStatus(slot.status),
            rejectionReason: slot.rejectReasonDescriptions ?? null,
            reviewedAt:
              slot.status === "APPROVED" || slot.status === "REJECTED"
                ? new Date()
                : undefined,
          },
        });
      }
    }

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "KYC_STATUS_UPDATED",
        result: "SUCCESS",
        resourceType: "asaas_account",
        resource: `asaas_account:${account.id}`,
        metadata: { newStatus, general: statusRes?.general },
      }
    );

    return NextResponse.json({
      status: newStatus,
      generalStatus: statusRes?.general,
      documentationStatus: statusRes?.documentation,
      commercialInfoStatus: statusRes?.commercialInfo,
      bankAccountInfoStatus: statusRes?.bankAccountInfo,
    });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors },
        { status: 422 }
      );
    }
    console.error("[onboarding/refresh]", err);
    return NextResponse.json(
      { error: "Falha ao sincronizar" },
      { status: 500 }
    );
  }
}

function mapDocSlotStatus(s: string): string {
  const up = s.toUpperCase();
  if (up === "APPROVED" || up === "REJECTED" || up === "PENDING") return up;
  if (up === "RECEIVED") return "PENDING";
  return "NOT_SENT";
}
