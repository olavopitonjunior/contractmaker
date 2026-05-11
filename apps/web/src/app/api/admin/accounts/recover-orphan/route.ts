/**
 * Recupera uma subconta órfã na Asaas — criada com sucesso lá mas cujo
 * commit local falhou após o POST /accounts. Sintoma: a conta tem
 * walletId/asaasId no dashboard Asaas mas NÃO aparece em /settings/pagamentos/contas.
 *
 * Fluxo:
 *  1. Lista subcontas via master key (filtro cpfCnpj/email/asaasId).
 *  2. Confirma que ela ainda não existe localmente (idempotente).
 *  3. Cria nova apiKey via POST /accounts/{id}/accessTokens (a original
 *     foi perdida — só vinha no POST inicial).
 *  4. Pega status detalhado via /myAccount/status com a apiKey nova.
 *  5. Lista slots KYC pendentes.
 *  6. Persiste AsaasAccount + OrgFinancialSettings + AsaasAccountDocument[].
 *
 * Permissão: ACCOUNT_CREATE (owner-only por padrão). Não exige elevation —
 * a conta já existe no Asaas, estamos só importando metadados.
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
  listSubaccounts,
  retrieveSubaccount,
  createSubaccountAccessToken,
  getMyAccountStatus,
  listMyAccountDocuments,
} from "@/lib/asaas/kyc";

const recoverSchema = z
  .object({
    asaasId: z.string().min(8).optional(),
    cpfCnpj: z.string().min(11).optional(),
    email: z.string().email().optional(),
    label: z.string().min(2).max(80).optional(),
    setActive: z.boolean().optional(),
  })
  .refine(
    (v) => Boolean(v.asaasId || v.cpfCnpj || v.email),
    "Informe asaasId, cpfCnpj ou email pra identificar a subconta"
  );

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
  const parsed = recoverSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    // 1) Localiza a subconta no Asaas via master key
    let subaccount;
    if (parsed.data.asaasId) {
      subaccount = await retrieveSubaccount({
        asaasAccountId: parsed.data.asaasId,
      });
    } else {
      const list = await listSubaccounts({
        cpfCnpj: parsed.data.cpfCnpj,
        email: parsed.data.email,
        limit: 20,
      });
      if (list.data.length === 0) {
        return NextResponse.json(
          {
            error: "NOT_FOUND",
            message:
              "Subconta não encontrada no Asaas com os filtros informados. Confirme cpfCnpj/email/asaasId.",
          },
          { status: 404 }
        );
      }
      if (list.data.length > 1) {
        return NextResponse.json(
          {
            error: "MULTIPLE_MATCHES",
            message:
              "Múltiplas subcontas casam o filtro. Use asaasId pra identificar exatamente qual.",
            matches: list.data.map((s) => ({
              asaasId: s.id,
              name: s.name,
              email: s.email,
              cpfCnpj: s.cpfCnpj,
              walletId: s.walletId,
            })),
          },
          { status: 409 }
        );
      }
      subaccount = list.data[0];
    }

    // 2) Idempotência: se já existe localmente, retorna early
    const existing = await prisma.asaasAccount.findFirst({
      where: { asaasId: subaccount.id },
    });
    if (existing) {
      return NextResponse.json({
        recovered: false,
        message: "Subconta já está cadastrada localmente",
        accountId: existing.id,
        asaasId: existing.asaasId,
        walletId: existing.walletId,
      });
    }

    // 3) Cria nova apiKey (a original foi perdida — só vem no POST /accounts)
    const tokenResp = await createSubaccountAccessToken({
      asaasAccountId: subaccount.id,
      name: `Contractmaker recovery ${new Date().toISOString().slice(0, 10)}`,
    });
    const apiKey = tokenResp.apiKey;
    if (!apiKey) {
      throw new Error(
        "Asaas não retornou apiKey no POST /accessTokens — recovery impossível"
      );
    }

    // 4) Status detalhado da subconta (com a apiKey nova)
    let statusGeneral = "PENDING";
    let statusDocs = "PENDING";
    let statusCommercial = "PENDING";
    let statusBank = "PENDING";
    try {
      const s = await getMyAccountStatus({ apiKey });
      statusGeneral = s.general ?? "PENDING";
      statusDocs = s.documentation ?? "PENDING";
      statusCommercial = s.commercialInfo ?? "PENDING";
      statusBank = s.bankAccountInfo ?? "PENDING";
    } catch (e) {
      console.warn(
        "[recover-orphan] /myAccount/status falhou — usando defaults",
        e instanceof Error ? e.message : e
      );
    }

    // 5) Lista slots KYC
    let docsListed: Array<{
      id: string;
      type: string;
      title?: string;
      description?: string | null;
      status: string;
    }> = [];
    try {
      const docs = await listMyAccountDocuments({ apiKey });
      docsListed = docs.data ?? [];
    } catch (e) {
      console.warn(
        "[recover-orphan] /myAccount/documents falhou — continuando sem slots",
        e instanceof Error ? e.message : e
      );
    }

    // 6) Persiste local — AsaasAccount + OrgFinancialSettings + docs
    const enc = encryptSecret(apiKey);
    const accountStatus = mapAccountStatus(statusGeneral, docsListed.length);

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
            recoveredAt: new Date().toISOString(),
            recoverySource: "POST /v3/accounts/{id}/accessTokens",
          } as Prisma.InputJsonValue,
          status: accountStatus,
          generalStatus: statusGeneral,
          documentationStatus: statusDocs,
          commercialInfoStatus: statusCommercial,
          bankAccountInfoStatus: statusBank,
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
          recovered: true,
          asaasId: created.asaasId,
          walletId: created.walletId,
          docsListed: docsListed.length,
          accessTokenId: tokenResp.id,
          accessTokenEnabled: tokenResp.enabled,
        },
      }
    );

    return NextResponse.json({
      recovered: true,
      accountId: created.id,
      asaasId: created.asaasId,
      walletId: created.walletId,
      status: created.status,
      docsListed: docsListed.length,
      accessTokenEnabled: tokenResp.enabled,
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
          recovered: true,
          error: err instanceof Error ? err.message : String(err),
          prismaCode,
          prismaMeta,
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
    console.error(
      "[recover-orphan]",
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
        error: "Falha ao recuperar subconta",
        message: err instanceof Error ? err.message : "unknown",
        prismaCode,
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
