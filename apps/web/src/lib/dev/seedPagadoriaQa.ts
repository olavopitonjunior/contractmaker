import { prisma } from "@/lib/db/prisma";
import { encryptSecret, generatePublicToken } from "@/lib/security/crypto";
import crypto from "node:crypto";

export interface SeedResult {
  orgId: string;
  accountId: string;
  customerIds: string[];
  chargeIds: string[];
  publicLinkToken: string;
  dualApprovalId: string;
  reconciliationIds: string[];
  settingsId: string;
}

const QA_PREFIX = "[QA UX]";

function fakeAsaasId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

/**
 * Popula dados fake para QA UX/UI do módulo Pagadoria.
 *
 * - Upsert AsaasAccount com status=APPROVED (não chama Asaas real).
 * - Cria 3 AsaasCustomer (PF + PJ + um repetido para deduplicate).
 * - Cria 12 CommissionCharge cobrindo todos os statuses.
 * - Cria 1 ChargePublicLink para testar /pay/[token].
 * - Cria 1 DualApproval pendente para testar banner + UI de aprovação.
 * - Cria 3 BankReconciliation (matched + pending + ignored).
 * - Upsert OrgFinancialSettings com branding + overprice + preset desconto.
 *
 * Idempotente por prefixo [QA UX]: re-rodar não duplica charges — limpa e recria.
 */
export async function seedPagadoriaQa(orgId: string, initiatorUserId: string): Promise<SeedResult> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error(`Org ${orgId} não encontrada`);

  // ============================================
  // 1) AsaasAccount APPROVED (fake)
  // ============================================
  const encKey = encryptSecret("$aact_QA_FAKE_KEY_do_not_use_in_prod");
  const account = await prisma.asaasAccount.upsert({
    where: { orgId },
    update: {
      status: "APPROVED",
      approvedAt: new Date(),
      lastStatusCheckAt: new Date(),
      generalStatus: "APPROVED",
      documentationStatus: "APPROVED",
      commercialInfoStatus: "APPROVED",
      bankAccountInfoStatus: "APPROVED",
      rejectionReason: null,
    },
    create: {
      orgId,
      asaasId: fakeAsaasId("acc"),
      walletId: fakeAsaasId("wal"),
      accountNumber: "123456-7",
      apiKeyEncrypted: encKey.ciphertext,
      apiKeyIvBase64: encKey.iv,
      apiKeyTagBase64: encKey.tag,
      personType: "LEGAL",
      kyc: {
        name: `${QA_PREFIX} Imobiliária Teste LTDA`,
        cnpj: "12.345.678/0001-90",
        incomeValue: 200000,
      },
      status: "APPROVED",
      approvedAt: new Date(),
      lastStatusCheckAt: new Date(),
      generalStatus: "APPROVED",
      documentationStatus: "APPROVED",
      commercialInfoStatus: "APPROVED",
      bankAccountInfoStatus: "APPROVED",
    },
  });

  // ============================================
  // 2) OrgFinancialSettings com branding
  // ============================================
  const settings = await prisma.orgFinancialSettings.upsert({
    where: { orgId },
    update: {
      overpricePolicy: "asaas_fee",
      overpriceType: "fixed",
      overpriceValue: 0,
      discountPresets: [
        {
          label: `${QA_PREFIX} Pagamento antecipado 5%`,
          type: "PERCENTAGE",
          value: 5,
          dueDayOffset: -3,
        },
      ],
      finePercent: 2.0,
      interestPercentMonth: 1.0,
      brandDisplayName: `${QA_PREFIX} Zimmermann Imóveis`,
      brandPrimaryColor: "#0f172a",
      brandSupportEmail: "contato@qa-teste.com.br",
      brandSupportPhone: "(11) 9 9999-9999",
    },
    create: {
      orgId,
      overpricePolicy: "asaas_fee",
      overpriceType: "fixed",
      overpriceValue: 0,
      discountPresets: [
        {
          label: `${QA_PREFIX} Pagamento antecipado 5%`,
          type: "PERCENTAGE",
          value: 5,
          dueDayOffset: -3,
        },
      ],
      brandDisplayName: `${QA_PREFIX} Zimmermann Imóveis`,
      brandPrimaryColor: "#0f172a",
      brandSupportEmail: "contato@qa-teste.com.br",
      brandSupportPhone: "(11) 9 9999-9999",
    },
  });

  // ============================================
  // 3) Limpar dados QA prévios (idempotência)
  // ============================================
  // Deleta em ordem de dependência: BankReconciliation → ChargePublicLink → CommissionCharge → AsaasCustomer → DualApproval
  await prisma.bankReconciliation.deleteMany({
    where: { orgId, description: { startsWith: QA_PREFIX } },
  });
  await prisma.chargePublicLink.deleteMany({
    where: { charge: { orgId, description: { startsWith: QA_PREFIX } } },
  });
  await prisma.commissionCharge.deleteMany({
    where: { orgId, description: { startsWith: QA_PREFIX } },
  });
  await prisma.asaasCustomer.deleteMany({
    where: { orgId, name: { startsWith: QA_PREFIX } },
  });
  await prisma.dualApproval.deleteMany({
    where: {
      orgId,
      status: "PENDING",
      reason: { startsWith: QA_PREFIX },
    },
  });

  // ============================================
  // 4) AsaasCustomer — 3 pagadores
  // ============================================
  const customer1 = await prisma.asaasCustomer.create({
    data: {
      orgId,
      asaasId: fakeAsaasId("cus"),
      name: `${QA_PREFIX} Maria Aparecida de Souza`,
      cpfCnpj: "52998224725",
      email: "maria-qa@mailinator.com",
      mobilePhone: "11999998888",
      addressJson: { postalCode: "01310100", street: "Av. Paulista, 1000" },
      origin: "manual",
    },
  });
  const customer2 = await prisma.asaasCustomer.create({
    data: {
      orgId,
      asaasId: fakeAsaasId("cus"),
      name: `${QA_PREFIX} João Silva Empreendimentos LTDA`,
      cpfCnpj: "12345678000190",
      email: "joao-qa@mailinator.com",
      mobilePhone: "11988887777",
      addressJson: { postalCode: "04538133", street: "Faria Lima, 500" },
      origin: "manual",
    },
  });
  const customer3 = await prisma.asaasCustomer.create({
    data: {
      orgId,
      asaasId: fakeAsaasId("cus"),
      name: `${QA_PREFIX} Rafael Oliveira Santos`,
      cpfCnpj: "11144477735",
      email: "rafael-qa@mailinator.com",
      mobilePhone: "11977776666",
      addressJson: { postalCode: "05407002", street: "R. Oscar Freire, 200" },
      origin: "manual",
    },
  });

  // ============================================
  // 5) CommissionCharge — 12 cobranças variadas
  // ============================================
  const now = new Date();
  const chargesData = [
    // PENDING (3)
    { customer: customer1, value: 5800, status: "PENDING", asaasStatus: "pending", billingType: "PIX", due: daysFromNow(7), desc: "Comissão Venda Jardins" },
    { customer: customer2, value: 12000, status: "PENDING", asaasStatus: "pending", billingType: "BOLETO", due: daysFromNow(15), desc: "Aluguel Barra — Janeiro" },
    { customer: customer3, value: 3500, status: "PENDING", asaasStatus: "pending", billingType: "PIX", due: daysFromNow(3), desc: "Comissão Locação Pinheiros" },

    // RECEIVED (4)
    { customer: customer1, value: 8200, status: "RECEIVED", asaasStatus: "received", billingType: "PIX", due: daysFromNow(-5), paid: daysFromNow(-3), desc: "Comissão Venda Vila Madalena" },
    { customer: customer2, value: 15000, status: "RECEIVED", asaasStatus: "received", billingType: "BOLETO", due: daysFromNow(-12), paid: daysFromNow(-10), desc: "Comissão Venda Alto de Pinheiros" },
    { customer: customer3, value: 2800, status: "RECEIVED", asaasStatus: "received", billingType: "PIX", due: daysFromNow(-20), paid: daysFromNow(-18), desc: "Taxa administrativa Q1" },
    { customer: customer1, value: 6500, status: "RECEIVED", asaasStatus: "received", billingType: "PIX", due: daysFromNow(-25), paid: daysFromNow(-23), desc: "Comissão Venda Moema" },

    // CONFIRMED (1) — pago mas ainda não creditado
    { customer: customer2, value: 9800, status: "CONFIRMED", asaasStatus: "confirmed", billingType: "BOLETO", due: daysFromNow(-1), paid: now, desc: "Comissão Venda Itaim" },

    // OVERDUE (2)
    { customer: customer3, value: 4200, status: "OVERDUE", asaasStatus: "overdue", billingType: "BOLETO", due: daysFromNow(-8), desc: "Comissão Venda Botafogo" },
    { customer: customer1, value: 7100, status: "OVERDUE", asaasStatus: "overdue", billingType: "PIX", due: daysFromNow(-15), desc: "Comissão Venda Leblon" },

    // CANCELLED (1)
    { customer: customer2, value: 3300, status: "CANCELLED", asaasStatus: "cancelled", billingType: "PIX", due: daysFromNow(-2), cancelled: daysFromNow(-1), desc: "Comissão Venda Copacabana (cancelada)" },

    // REFUNDED (1)
    { customer: customer3, value: 5500, status: "REFUNDED", asaasStatus: "refunded", billingType: "PIX", due: daysFromNow(-30), paid: daysFromNow(-28), refunded: daysFromNow(-15), desc: "Comissão Venda Tijuca (estornada)" },
  ];

  const chargeIds: string[] = [];
  let firstPendingId: string | null = null;

  for (const c of chargesData) {
    const charge = await prisma.commissionCharge.create({
      data: {
        orgId,
        asaasCustomerId: c.customer.id,
        asaasPaymentId: fakeAsaasId("pay"),
        kind: "commission",
        billingType: c.billingType,
        value: c.value,
        netValue: c.billingType === "PIX" ? c.value - 1.99 : c.value - 3.49,
        originalDueDate: c.due,
        currentDueDate: c.due,
        status: c.status,
        asaasStatus: c.asaasStatus,
        description: `${QA_PREFIX} ${c.desc}`,
        paidAt: "paid" in c ? c.paid : null,
        cancelledAt: "cancelled" in c ? c.cancelled : null,
        refundedAt: "refunded" in c ? c.refunded : null,
        lastEventAt: new Date(),
        pixQrCodePayload:
          c.billingType === "PIX"
            ? "00020101021226830014br.gov.bcb.pix2561qa-mock-key@test.com.br5204000053039865405" +
              c.value.toFixed(2) +
              "5802BR5923QA UX Teste6009SAO PAULO62070503***6304ABCD"
            : null,
        identificationField:
          c.billingType === "BOLETO"
            ? "23793.38128 60082.960051 41234.510003 1 99190000" +
              Math.floor(c.value * 100).toString().padStart(8, "0")
            : null,
        payerSnapshot: {
          name: c.customer.name,
          cpfCnpj: c.customer.cpfCnpj,
          email: c.customer.email,
        },
      },
    });
    chargeIds.push(charge.id);
    if (!firstPendingId && c.status === "PENDING") firstPendingId = charge.id;
  }

  // ============================================
  // 6) ChargePublicLink para a primeira charge PENDING
  // ============================================
  if (!firstPendingId) throw new Error("seed: nenhuma charge PENDING criada");
  const publicToken = generatePublicToken(12);
  await prisma.chargePublicLink.create({
    data: {
      chargeId: firstPendingId,
      publicToken,
      brandSnapshot: {
        logoUrl: null,
        primaryColor: settings.brandPrimaryColor,
        displayName: settings.brandDisplayName,
        supportEmail: settings.brandSupportEmail,
        supportPhone: settings.brandSupportPhone,
      },
    },
  });

  // ============================================
  // 7) DualApproval pendente — transferência fake
  // ============================================
  const payloadJson = {
    type: "PIX",
    value: 75000,
    pixAddressKey: "12345678000190",
    pixKeyType: "CNPJ",
    description: `${QA_PREFIX} Transferência para conta da empresa`,
  };
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payloadJson))
    .digest("hex");
  const dualApproval = await prisma.dualApproval.create({
    data: {
      orgId,
      initiatedBy: initiatorUserId,
      kind: "TRANSFER",
      payloadJson,
      payloadHash,
      amount: 75000,
      reason: `${QA_PREFIX} Transferência acima do cap de R$ 50k — aguardando 2ª aprovação`,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  // ============================================
  // 8) BankReconciliation — 3 lançamentos
  // ============================================
  // Matched — associado a uma charge RECEIVED
  const receivedCharge = await prisma.commissionCharge.findFirst({
    where: { orgId, status: "RECEIVED", description: { startsWith: QA_PREFIX } },
  });
  const reconMatched = await prisma.bankReconciliation.create({
    data: {
      orgId,
      financialTransactionId: `fin_${crypto.randomBytes(6).toString("hex")}`,
      type: "PAYMENT_RECEIVED",
      value: receivedCharge?.value ?? 8200,
      date: daysFromNow(-3),
      description: `${QA_PREFIX} Crédito recebido — Venda Vila Madalena`,
      asaasPaymentId: receivedCharge?.asaasPaymentId ?? null,
      matchedChargeId: receivedCharge?.id ?? null,
      status: "matched",
      matchedAt: daysFromNow(-3),
    },
  });
  const reconPending = await prisma.bankReconciliation.create({
    data: {
      orgId,
      financialTransactionId: `fin_${crypto.randomBytes(6).toString("hex")}`,
      type: "PAYMENT_RECEIVED",
      value: 4200,
      date: daysFromNow(-1),
      description: `${QA_PREFIX} Crédito não identificado — investigar`,
      status: "pending",
    },
  });
  const reconIgnored = await prisma.bankReconciliation.create({
    data: {
      orgId,
      financialTransactionId: `fin_${crypto.randomBytes(6).toString("hex")}`,
      type: "PAYMENT_FEE",
      value: -1.99,
      date: daysFromNow(-3),
      description: `${QA_PREFIX} Taxa Asaas PIX`,
      status: "ignored",
    },
  });

  return {
    orgId,
    accountId: account.id,
    customerIds: [customer1.id, customer2.id, customer3.id],
    chargeIds,
    publicLinkToken: publicToken,
    dualApprovalId: dualApproval.id,
    reconciliationIds: [reconMatched.id, reconPending.id, reconIgnored.id],
    settingsId: settings.id,
  };
}

/**
 * Remove todos os dados QA UX (prefixo [QA UX]) da org.
 * Também reverte AsaasAccount para AWAITING_DOCS.
 */
export async function cleanupPagadoriaQa(orgId: string): Promise<{ deleted: Record<string, number> }> {
  const deleted: Record<string, number> = {};

  const recon = await prisma.bankReconciliation.deleteMany({
    where: { orgId, description: { startsWith: QA_PREFIX } },
  });
  deleted.reconciliations = recon.count;

  const publicLinks = await prisma.chargePublicLink.deleteMany({
    where: { charge: { orgId, description: { startsWith: QA_PREFIX } } },
  });
  deleted.publicLinks = publicLinks.count;

  const charges = await prisma.commissionCharge.deleteMany({
    where: { orgId, description: { startsWith: QA_PREFIX } },
  });
  deleted.charges = charges.count;

  const customers = await prisma.asaasCustomer.deleteMany({
    where: { orgId, name: { startsWith: QA_PREFIX } },
  });
  deleted.customers = customers.count;

  const duals = await prisma.dualApproval.deleteMany({
    where: { orgId, reason: { startsWith: QA_PREFIX } },
  });
  deleted.dualApprovals = duals.count;

  // Reverte AsaasAccount para AWAITING_DOCS (como estava antes do QA)
  const account = await prisma.asaasAccount.findUnique({ where: { orgId } });
  if (account) {
    await prisma.asaasAccount.update({
      where: { orgId },
      data: {
        status: "AWAITING_DOCS",
        approvedAt: null,
        generalStatus: "PENDING",
        documentationStatus: "PENDING",
      },
    });
    deleted.accountsReverted = 1;
  }

  return { deleted };
}
