import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
import { audit } from "@/lib/security/audit";
import { encryptSecret } from "@/lib/security/crypto";
import { AsaasError } from "@/lib/asaas/errors";
import {
  createSubaccount,
  listMyAccountDocuments,
} from "@/lib/asaas/kyc";

const subaccountSchema = z.object({
  personType: z.enum(["PHYSICAL", "LEGAL"]),
  name: z.string().min(2),
  email: z.string().email(),
  cpfCnpj: z.string().min(11),
  mobilePhone: z.string().min(10),
  incomeValue: z.number().positive(),
  postalCode: z.string().min(8),
  address: z.string().min(2),
  addressNumber: z.string().min(1),
  complement: z.string().optional(),
  province: z.string().min(2),
  birthDate: z.string().optional(), // PF only, YYYY-MM-DD
  companyType: z.enum(["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"]).optional(), // PJ only
  phone: z.string().optional(),
  site: z.string().optional(),
});

/**
 * POST /api/financeiro/onboarding/subaccount
 * Cria subconta Asaas via POST /v3/accounts.
 * Exige elevation KYC_EDIT + permission kyc.submit.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.KYC_SUBMIT,
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

  // Guard: já tem subconta
  const existing = await prisma.asaasAccount.findUnique({
    where: { orgId: ctx.orgId },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Já existe subconta Asaas para esta organização", status: existing.status },
      { status: 409 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = subaccountSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/webhooks/asaas`;
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;

  try {
    const subaccount = await createSubaccount({
      name: data.name,
      email: data.email,
      cpfCnpj: data.cpfCnpj,
      mobilePhone: data.mobilePhone,
      phone: data.phone,
      site: data.site,
      incomeValue: data.incomeValue,
      address: data.address,
      addressNumber: data.addressNumber,
      complement: data.complement,
      province: data.province,
      postalCode: data.postalCode,
      birthDate: data.birthDate,
      companyType: data.companyType,
      webhooks: webhookToken
        ? [
            {
              name: "Contractmaker default",
              url: webhookUrl,
              email: data.email,
              enabled: true,
              interrupted: false,
              authToken: webhookToken,
              apiVersion: 3,
              events: [
                "PAYMENT_CREATED",
                "PAYMENT_UPDATED",
                "PAYMENT_CONFIRMED",
                "PAYMENT_RECEIVED",
                "PAYMENT_OVERDUE",
                "PAYMENT_DELETED",
                "PAYMENT_REFUNDED",
                "ACCOUNT_STATUS_UPDATED",
              ],
            },
          ]
        : undefined,
    });

    // Encrypt apiKey antes de persistir
    const enc = encryptSecret(subaccount.apiKey);

    // Persist local record
    const account = await prisma.asaasAccount.create({
      data: {
        orgId: ctx.orgId,
        asaasId: subaccount.id,
        walletId: subaccount.walletId,
        accountNumber: subaccount.accountNumber
          ? `${subaccount.accountNumber.agency}/${subaccount.accountNumber.account}-${subaccount.accountNumber.accountDigit}`
          : null,
        apiKeyEncrypted: enc.ciphertext,
        apiKeyIvBase64: enc.iv,
        apiKeyTagBase64: enc.tag,
        personType: data.personType,
        kyc: {
          name: data.name,
          email: data.email,
          cpfCnpjMasked: data.cpfCnpj.slice(0, 3) + "***" + data.cpfCnpj.slice(-2),
          incomeValue: data.incomeValue,
          postalCode: data.postalCode,
          companyType: data.companyType,
          personType: data.personType,
          submittedAt: new Date().toISOString(),
        } as any,
        status: "PENDING",
        generalStatus: subaccount.status?.general ?? "PENDING",
        documentationStatus: subaccount.status?.documentation ?? "PENDING",
        commercialInfoStatus: subaccount.status?.commercialInfo ?? "PENDING",
        bankAccountInfoStatus: subaccount.status?.bankAccountInfo ?? "PENDING",
      },
    });

    // Fetch document slots (lista de docs pendentes)
    try {
      const docsRes = await listMyAccountDocuments({ apiKey: subaccount.apiKey });
      if (docsRes?.data?.length) {
        await prisma.asaasAccountDocument.createMany({
          data: docsRes.data.map((slot) => ({
            accountId: account.id,
            asaasDocumentId: slot.id,
            type: slot.type,
            title: slot.title ?? slot.type,
            description: slot.description ?? null,
            status: mapDocSlotStatus(slot.status),
          })),
          skipDuplicates: true,
        });
      }
    } catch (err) {
      console.error(
        "[onboarding/subaccount] listDocuments falhou — continuando sem slots",
        err instanceof Error ? err.message : err
      );
    }

    // Se já há docs listados, atualiza status da account para AWAITING_DOCS
    const docCount = await prisma.asaasAccountDocument.count({
      where: { accountId: account.id },
    });
    if (docCount > 0) {
      await prisma.asaasAccount.update({
        where: { id: account.id },
        data: { status: "AWAITING_DOCS" },
      });
    }

    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "KYC_SUBMIT",
        result: "SUCCESS",
        resourceType: "asaas_account",
        resource: `asaas_account:${account.id}`,
        metadata: {
          asaasId: subaccount.id,
          walletId: subaccount.walletId,
          personType: data.personType,
        },
      }
    );

    return NextResponse.json({
      accountId: account.id,
      asaasId: subaccount.id,
      walletId: subaccount.walletId,
      status: "PENDING",
      docsListed: docCount,
    });
  } catch (err) {
    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "KYC_SUBMIT",
        result: "FAILURE",
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      }
    );

    if (err instanceof AsaasError) {
      return NextResponse.json(
        {
          error: "ASAAS_ERROR",
          status: err.status,
          details: err.errors,
        },
        { status: err.status === 401 ? 500 : 422 }
      );
    }
    console.error("[onboarding/subaccount]", err);
    return NextResponse.json(
      { error: "Falha ao criar subconta", message: err instanceof Error ? err.message : "unknown" },
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
