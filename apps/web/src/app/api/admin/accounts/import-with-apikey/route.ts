/**
 * Importa subconta Asaas existente cuja apiKey o usuário obteve por outro
 * caminho (link de ativação por email, suporte Asaas, painel manual).
 *
 * Use case: recover-orphan falhou com whitelist error e o usuário pegou a
 * apiKey via fallback resendActivationLink → portal Asaas.
 *
 * Fluxo:
 *  1. Valida a apiKey chamando /myAccount/status com ela
 *  2. Busca metadados da subconta via /accounts/{id} (master key)
 *  3. Confirma idempotência — se já existe localmente, retorna early
 *  4. Lista slots KYC com a apiKey
 *  5. Persiste AsaasAccount + OrgFinancialSettings + AsaasAccountDocument[]
 *     em transaction
 *  6. Audit ACCOUNT_CREATE com metadata.imported=true
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { encryptSecret } from "@/lib/security/crypto";
import { AsaasError } from "@/lib/asaas/errors";
import {
  retrieveSubaccount,
  getMyAccountStatus,
  listMyAccountDocuments,
} from "@/lib/asaas/kyc";

const importSchema = z.object({
  asaasId: z.string().min(8),
  apiKey: z.string().min(20),
  label: z.string().min(2).max(80).optional(),
  setActive: z.boolean().optional(),
});

function mapDocSlotStatus(s: string): string {
  const up = s.toUpperCase();
  if (up === "APPROVED" || up === "REJECTED" || up === "PENDING") return up;
  if (up === "RECEIVED") return "PENDING";
  return "NOT_SENT";
}

function mapAccountStatus(generalStatus: string, docsListed: number): string {
  const g = generalStatus.toUpperCase();
  if (g === "APPROVED") return "APPROVED";
  if (g === "REJECTED") return "REJECTED";
  if (g === "AWAITING_APPROVAL") return "AWAITING_APPROVAL";
  if (g === "AWAITING_ACTION_AUTHORIZATION") return "BLOCKED";
  return docsListed > 0 ? "AWAITING_DOCS" : "PENDING";
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ACCOUNT_CREATE,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      {
        error: "Body inválido",
        message: issues,
        details: parsed.error.format(),
      },
      { status: 400 }
    );
  }

  try {
    // 1) Valida apiKey — se inválida, /myAccount/status retorna 401
    let statusResp;
    try {
      statusResp = await getMyAccountStatus({ apiKey: parsed.data.apiKey });
    } catch (validateErr) {
      if (validateErr instanceof AsaasError && validateErr.status === 401) {
        return NextResponse.json(
          {
            error: "INVALID_APIKEY",
            message:
              "ApiKey rejeitada pelo Asaas. Confira que copiou inteira e que a subconta foi ativada (link de ativação clicado).",
          },
          { status: 422 }
        );
      }
      throw validateErr;
    }

    // 2) Busca metadados via master key
    const subaccount = await retrieveSubaccount({
      asaasAccountId: parsed.data.asaasId,
    });

    // 3) Idempotência
    const existing = await prisma.asaasAccount.findFirst({
      where: { asaasId: subaccount.id },
    });
    if (existing) {
      return NextResponse.json({
        imported: false,
        message: "Subconta já está cadastrada localmente",
        accountId: existing.id,
        asaasId: existing.asaasId,
        walletId: existing.walletId,
      });
    }

    // 4) Lista slots KYC
    let docsListed: Array<{
      id: string;
      type: string;
      title?: string;
      description?: string | null;
      status: string;
    }> = [];
    try {
      const docs = await listMyAccountDocuments({ apiKey: parsed.data.apiKey });
      docsListed = docs.data ?? [];
    } catch (e) {
      console.warn(
        "[import-with-apikey] /myAccount/documents falhou — continuando sem slots",
        e instanceof Error ? e.message : e
      );
    }

    // 5) Persiste
    const enc = encryptSecret(parsed.data.apiKey);
    const accountStatus = mapAccountStatus(
      statusResp.general ?? "PENDING",
      docsListed.length
    );
    const personType =
      subaccount.personType === "JURIDICA" ? "LEGAL" : "PHYSICAL";

    const created = await prisma.$transaction(async (tx) => {
      const account = await tx.asaasAccount.create({
        data: {
          orgId: ctx.orgId,
          label: parsed.data.label ?? null,
          asaasId: subaccount.id,
          walletId: subaccount.walletId,
          accountNumber: subaccount.accountNumber
            ? `${subaccount.accountNumber.agency}/${subaccount.accountNumber.account}-${subaccount.accountNumber.accountDigit}`
            : null,
          apiKeyEncrypted: enc.ciphertext,
          apiKeyIvBase64: enc.iv,
          apiKeyTagBase64: enc.tag,
          personType,
          kyc: {
            name: subaccount.name,
            email: subaccount.email,
            cpfCnpjMasked:
              subaccount.cpfCnpj.slice(0, 3) +
              "***" +
              subaccount.cpfCnpj.slice(-2),
            personType,
            companyType: subaccount.companyType,
            importedAt: new Date().toISOString(),
            importSource: "apikey paste (whitelist fallback)",
          } as Prisma.InputJsonValue,
          status: accountStatus,
          generalStatus: statusResp.general ?? "PENDING",
          documentationStatus: statusResp.documentation ?? "PENDING",
          commercialInfoStatus: statusResp.commercialInfo ?? "PENDING",
          bankAccountInfoStatus: statusResp.bankAccountInfo ?? "PENDING",
        },
      });

      await tx.orgFinancialSettings.create({
        data: { orgId: ctx.orgId, accountId: account.id },
      });

      if (docsListed.length > 0) {
        await tx.asaasAccountDocument.createMany({
          data: docsListed.map((slot) => ({
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

      if (parsed.data.setActive) {
        await tx.organization.update({
          where: { id: ctx.orgId },
          data: { activeAsaasAccountId: account.id },
        });
      }

      return account;
    });

    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "ACCOUNT_CREATE",
        result: "SUCCESS",
        resourceType: "asaas_account",
        resource: `asaas_account:${created.id}`,
        metadata: {
          imported: true,
          asaasId: created.asaasId,
          walletId: created.walletId,
          docsListed: docsListed.length,
        },
      }
    );

    return NextResponse.json({
      imported: true,
      accountId: created.id,
      asaasId: created.asaasId,
      walletId: created.walletId,
      status: created.status,
      docsListed: docsListed.length,
    });
  } catch (err) {
    const errAny = err as Record<string, unknown> | null;
    const prismaCode = typeof errAny?.code === "string" ? errAny.code : undefined;
    const prismaMeta = errAny?.meta ?? undefined;
    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "ACCOUNT_CREATE",
        result: "FAILURE",
        metadata: {
          imported: true,
          error: err instanceof Error ? err.message : String(err),
          prismaCode,
          prismaMeta,
        },
      }
    );
    if (err instanceof AsaasError) {
      console.error(
        "[import-with-apikey][asaas]",
        JSON.stringify({
          status: err.status,
          message: err.message,
          errors: err.errors,
        })
      );
      return NextResponse.json(
        {
          error: "ASAAS_ERROR",
          status: err.status,
          details: err.errors,
          message:
            err.errors?.[0]?.description ??
            err.message ??
            "Asaas rejeitou a operação",
        },
        { status: err.status === 401 ? 500 : 422 }
      );
    }
    console.error(
      "[import-with-apikey]",
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        prismaCode,
        prismaMeta,
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6).join(" | ") : undefined,
      })
    );
    return NextResponse.json(
      {
        error: "Falha ao importar subconta",
        message: err instanceof Error ? err.message : "unknown",
        prismaCode,
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
