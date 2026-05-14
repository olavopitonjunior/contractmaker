/**
 * Cria uma nova subconta Asaas + persiste como AsaasAccount + lista docs KYC.
 *
 * Extraído de `app/api/financeiro/onboarding/subaccount/route.ts` para reuso
 * em `/api/financeiro/accounts` (POST). Sem guard "já existe" — caller decide
 * se permite múltiplas contas (multi-account: sempre permite; bootstrap legado:
 * tem o guard).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/security/crypto";
import {
  createSubaccount,
  listMyAccountDocuments,
} from "./kyc";

export interface CreateAccountInput {
  orgId: string;
  personType: "PHYSICAL" | "LEGAL";
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone: string;
  incomeValue: number;
  postalCode: string;
  address: string;
  addressNumber: string;
  complement?: string;
  province: string;
  birthDate?: string;
  companyType?: "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";
  phone?: string;
  site?: string;
  /** Rótulo livre pra distinguir contas no seletor (ex: "Imobiliária PJ"). */
  label?: string;
  /** Quando true, define a recém-criada como ativa da org. */
  setActive?: boolean;
}

export interface CreateAccountResult {
  accountId: string;
  asaasId: string;
  walletId: string;
  status: string;
  docsListed: number;
}

function mapDocSlotStatus(s: string): string {
  const up = s.toUpperCase();
  if (up === "APPROVED" || up === "REJECTED" || up === "PENDING") return up;
  if (up === "RECEIVED") return "PENDING";
  return "NOT_SENT";
}

export async function createAsaasAccount(
  input: CreateAccountInput
): Promise<CreateAccountResult> {
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/webhooks/asaas`;
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const webhookConfigurable = webhookUrl.startsWith("https://");

  const subaccount = await createSubaccount({
    name: input.name,
    email: input.email,
    cpfCnpj: input.cpfCnpj,
    mobilePhone: input.mobilePhone,
    phone: input.phone,
    site: input.site,
    incomeValue: input.incomeValue,
    address: input.address,
    addressNumber: input.addressNumber,
    complement: input.complement,
    province: input.province,
    postalCode: input.postalCode,
    birthDate: input.birthDate,
    companyType: input.companyType,
    webhooks:
      webhookToken && webhookConfigurable
        ? [
            {
              name: "Contractmaker default",
              url: webhookUrl,
              email: input.email,
              enabled: true,
              interrupted: false,
              authToken: webhookToken,
              apiVersion: 3,
              sendType: "SEQUENTIALLY",
              events: [
                "PAYMENT_CREATED",
                "PAYMENT_UPDATED",
                "PAYMENT_CONFIRMED",
                "PAYMENT_RECEIVED",
                "PAYMENT_OVERDUE",
                "PAYMENT_DELETED",
                "PAYMENT_REFUNDED",
              ],
            },
          ]
        : undefined,
  });

  const enc = encryptSecret(subaccount.apiKey);

  const account = await prisma.asaasAccount.create({
    data: {
      orgId: input.orgId,
      label: input.label ?? null,
      asaasId: subaccount.id,
      walletId: subaccount.walletId,
      accountNumber: subaccount.accountNumber
        ? `${subaccount.accountNumber.agency}/${subaccount.accountNumber.account}-${subaccount.accountNumber.accountDigit}`
        : null,
      apiKeyEncrypted: enc.ciphertext,
      apiKeyIvBase64: enc.iv,
      apiKeyTagBase64: enc.tag,
      personType: input.personType,
      kyc: {
        name: input.name,
        email: input.email,
        cpfCnpjMasked:
          input.cpfCnpj.slice(0, 3) + "***" + input.cpfCnpj.slice(-2),
        incomeValue: input.incomeValue,
        postalCode: input.postalCode,
        companyType: input.companyType,
        personType: input.personType,
        submittedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
      status: "PENDING",
      generalStatus: subaccount.status?.general ?? "PENDING",
      documentationStatus: subaccount.status?.documentation ?? "PENDING",
      commercialInfoStatus: subaccount.status?.commercialInfo ?? "PENDING",
      bankAccountInfoStatus: subaccount.status?.bankAccountInfo ?? "PENDING",
      // Asaas dispara email de ativação automaticamente no POST /accounts.
      activationLinkSentAt: new Date(),
    },
  });

  // Cria OrgFinancialSettings com defaults (per-account a partir desta migration).
  // Se a org tem settings legados sem accountId, deixa pro admin migrar manualmente
  // (rare path — backfill já cuidou de orgs com 1 conta antiga).
  await prisma.orgFinancialSettings.create({
    data: {
      orgId: input.orgId,
      accountId: account.id,
    },
  });

  // Listagem inicial de slots de docs KYC. Falha silenciosa: melhor ter conta
  // criada sem slots do que rollback completo.
  let docsListed = 0;
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
      docsListed = docsRes.data.length;
    }
  } catch (err) {
    console.error(
      "[account-create] listDocuments falhou — continuando sem slots",
      err instanceof Error ? err.message : err
    );
  }

  if (docsListed > 0) {
    await prisma.asaasAccount.update({
      where: { id: account.id },
      data: { status: "AWAITING_DOCS" },
    });
  }

  if (input.setActive) {
    await prisma.organization.update({
      where: { id: input.orgId },
      data: { activeAsaasAccountId: account.id },
    });
  }

  return {
    accountId: account.id,
    asaasId: subaccount.id,
    walletId: subaccount.walletId,
    status: docsListed > 0 ? "AWAITING_DOCS" : "PENDING",
    docsListed,
  };
}
