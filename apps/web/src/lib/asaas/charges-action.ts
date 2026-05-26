import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { AsaasError } from "@/lib/asaas/errors";
import { upsertCustomer } from "@/lib/asaas/customers";
import { getAccountWithApiKey } from "@/lib/asaas/account";
import { resolvePlatformFee } from "@/lib/asaas/platform-fee";
import {
  createPayment,
  getPixQrCode,
  getBankSlipData,
} from "@/lib/asaas/payments";
import {
  resolvePayer,
  resolveCommissionValue,
  buildCommissionPayload,
  generatePayerVisibleDescription,
  CommissionBuildError,
  type DadosContratoLite,
  type SplitInputEntry,
  type SplitDisplay,
  type ResolvedPayer,
} from "@/lib/asaas/commission";
import { notifyChargeEvent } from "@/lib/financeiro/notifications";

/**
 * Lógica de criação de comissão Asaas — extraída do route handler para
 * reuso em (a) chamada session direta, (b) executor de ActionIntent
 * (CHARGE_CREATE).
 *
 * Caller é responsável por permission/rate-limit/sales-scope antes de chamar.
 * Esta função foca na criação propriamente: validações de dados, dedupe,
 * upsert customer, createPayment, persistência local.
 */

export interface CreateChargeInput {
  dealId: string;
  orgId: string;
  /**
   * Conta Asaas que emite a cobrança. Persistida em CommissionCharge.accountId
   * — paymentId/walletId são per-conta no Asaas, não dá pra trocar depois.
   */
  accountId: string;
  /** userId que dispara — usado em audit. */
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  billingType: "PIX" | "BOLETO";
  /** YYYY-MM-DD */
  dueDate: string;
  contractId?: string;
  description?: string;
  /**
   * Quando true, a função pula `audit()` (caller faz). Útil quando o caller
   * precisa enriquecer metadata (ex.: via=newton).
   */
  skipAudit?: boolean;
  // Pagadoria 2026-05-09 — overrides do wizard
  /** Splits custom com asaas_wallet + pix_external. Substitui auto-platform-only. */
  customSplits?: SplitInputEntry[];
  /** Override do pagador (papel + dados editados na UI). */
  payerOverride?: Partial<ResolvedPayer> & { papel?: "comprador" | "vendedor"; partyIndex?: number };
  /** Override do valor a cobrar. */
  valueOverride?: number;
  /** Display block — splits ocultos para o pagador. */
  display?: SplitDisplay;
  /** kind explícito (para avulsa em deal). Default = "commission". */
  kind?: "commission" | "avulsa" | "aluguel" | "outros";
  /** Categoria livre (apenas para kind != commission). */
  categoryLabel?: string;
}

export interface CreateChargeResult {
  status: number;
  body: Record<string, unknown>;
}

export async function runCreateCommissionCharge(
  input: CreateChargeInput
): Promise<CreateChargeResult> {
  const deal = await prisma.deal.findFirst({
    where: { id: input.dealId, pipeline: { orgId: input.orgId } },
    include: {
      contracts: {
        orderBy: { version: "desc" },
        take: 1,
        where: input.contractId ? { id: input.contractId } : { status: "aprovado" },
      },
    },
  });
  if (!deal) {
    return { status: 404, body: { error: "Deal não encontrado" } };
  }

  const contract = deal.contracts[0];
  if (!contract) {
    return {
      status: 422,
      body: { error: "Nenhum contrato aprovado neste deal" },
    };
  }
  if (contract.status !== "aprovado") {
    return {
      status: 422,
      body: { error: "Contrato precisa estar aprovado" },
    };
  }

  // Resolve a conta especificada (multi-account: caller passa accountId)
  const accountFromInput = await prisma.asaasAccount.findFirst({
    where: { id: input.accountId, orgId: input.orgId, archivedAt: null },
  });
  if (!accountFromInput) {
    return {
      status: 422,
      body: {
        error: "Conta Asaas inválida ou inacessível",
        accountId: input.accountId,
      },
    };
  }
  if (accountFromInput.status !== "APPROVED") {
    return {
      status: 422,
      body: {
        error: "Conta Asaas ainda não aprovada",
        accountStatus: accountFromInput.status,
      },
    };
  }
  const account = accountFromInput;

  // Duplicate guard
  const existingActive = await prisma.commissionCharge.findFirst({
    where: {
      contractId: contract.id,
      status: { notIn: ["REFUNDED", "CANCELLED", "CHARGEBACK"] },
      cancelledAt: null,
    },
  });
  if (existingActive) {
    return {
      status: 409,
      body: {
        error: "Já existe cobrança ativa para este contrato",
        existingChargeId: existingActive.id,
        existingStatus: existingActive.status,
      },
    };
  }

  // Build payload — settings agora são per-conta. Fallback pra org-level
  // mantido durante migração (settings antigas com accountId=null).
  // Fase 1d: markup global (PlatformConfig) com override per-org (OrgFinancialSettings).
  const { platformFeePercent, platformWalletId: resolvedPlatformWalletId } =
    await resolvePlatformFee(input.orgId, account.id);
  const platformWalletId = resolvedPlatformWalletId ?? undefined;

  let payer;
  let value;
  let payload;
  try {
    const data = contract.dataJson as unknown as DadosContratoLite;
    const { partyIndex, ...override } = input.payerOverride ?? {};
    payer = resolvePayer(data, {
      partyIndex: typeof partyIndex === "number" ? partyIndex : undefined,
      override: Object.keys(override).length > 0 ? (override as Partial<ResolvedPayer> & { papel?: "comprador" | "vendedor" }) : undefined,
    });
    value = resolveCommissionValue(data, { override: input.valueOverride });
    // Descrição: se não veio explícito, gera a partir dos splits visíveis
    // (omitindo os ocultos via display.hiddenRecipientIds). Default histórico
    // segue se não houver customSplits.
    const description =
      input.description ??
      (input.customSplits && input.customSplits.length > 0
        ? generatePayerVisibleDescription({
            splits: input.customSplits,
            hiddenRecipientIds: input.display?.hiddenRecipientIds ?? [],
            dealTitle: deal.title,
            kind: input.kind ?? "commission",
            categoryLabel: input.categoryLabel ?? null,
          })
        : `Comissão — ${deal.title} (${payer.papel === "comprador" ? "Comprador" : "Vendedor"})`);

    payload = buildCommissionPayload({
      contractData: data,
      payer,
      value,
      billingType: input.billingType,
      dueDate: input.dueDate,
      description,
      externalReference: `contract:${contract.id}`,
      orgWalletId: account.walletId,
      platformFeePercent: platformFeePercent > 0 ? platformFeePercent : undefined,
      platformWalletId:
        platformFeePercent > 0 && platformWalletId ? platformWalletId : undefined,
      customSplits: input.customSplits,
      display: input.display,
    });
  } catch (err) {
    if (err instanceof CommissionBuildError) {
      return { status: 422, body: { error: err.code, message: err.message } };
    }
    throw err;
  }

  const { apiKey } = await getAccountWithApiKey(account.id);

  try {
    const asaasCustomer = await upsertCustomer({
      input: payload.customerInput,
      apiKey,
    });
    // Customer agora é per-conta — mesmo CPF pode existir em N subcontas.
    const localCustomer = await prisma.asaasCustomer.upsert({
      where: {
        accountId_cpfCnpj: {
          accountId: account.id,
          cpfCnpj: asaasCustomer.cpfCnpj,
        },
      },
      create: {
        orgId: input.orgId,
        accountId: account.id,
        asaasId: asaasCustomer.id,
        name: asaasCustomer.name,
        cpfCnpj: asaasCustomer.cpfCnpj,
        email: asaasCustomer.email ?? null,
        mobilePhone: asaasCustomer.mobilePhone ?? null,
        origin: "deal_sync",
        sourceDealId: deal.id,
        externalReference: asaasCustomer.externalReference ?? null,
        lastSyncedAt: new Date(),
      },
      update: {
        asaasId: asaasCustomer.id,
        name: asaasCustomer.name,
        email: asaasCustomer.email ?? undefined,
        mobilePhone: asaasCustomer.mobilePhone ?? undefined,
        lastSyncedAt: new Date(),
      },
    });

    const payment = await createPayment({
      input: { customer: asaasCustomer.id, ...payload.paymentInput },
      apiKey,
    });

    let pixQr = null;
    let bankSlip = null;
    if (input.billingType === "PIX") {
      try {
        pixQr = await getPixQrCode({ asaasId: payment.id, apiKey });
      } catch (e) {
        console.warn(
          "[charges-action] getPixQrCode falhou",
          e instanceof Error ? e.message : e
        );
      }
    } else {
      try {
        bankSlip = await getBankSlipData({ asaasId: payment.id, apiKey });
      } catch (e) {
        console.warn(
          "[charges-action] getBankSlipData falhou",
          e instanceof Error ? e.message : e
        );
      }
    }

    const charge = await prisma.commissionCharge.create({
      data: {
        orgId: input.orgId,
        accountId: account.id,
        dealId: deal.id,
        contractId: contract.id,
        asaasCustomerId: localCustomer.id,
        asaasPaymentId: payment.id,
        kind: input.kind ?? "commission",
        categoryLabel: input.categoryLabel ?? null,
        billingType: input.billingType,
        value: payment.value,
        originalDueDate: new Date(payment.dueDate),
        currentDueDate: new Date(payment.dueDate),
        status: "PENDING",
        asaasStatus: payment.status,
        description: payment.description ?? null,
        invoiceUrl: payment.invoiceUrl ?? null,
        bankSlipUrl: payment.bankSlipUrl ?? bankSlip?.bankSlipUrl ?? null,
        identificationField: bankSlip?.identificationField ?? null,
        pixQrCodePayload: pixQr?.payload ?? null,
        pixQrCodeImage: pixQr?.encodedImage ?? null,
        splitJson:
          payload.paymentInput.split ||
          payload.externalSplits.length > 0 ||
          payload.display
            ? ({
                splits: payload.paymentInput.split ?? [],
                external: payload.externalSplits,
                display: payload.display ?? undefined,
              } as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        payerSnapshot: payer as unknown as Prisma.InputJsonValue,
        beneficiarySnapshot: {
          imobiliaria_nome:
            (contract.dataJson as Record<string, unknown> | null)?.comissao &&
            typeof (contract.dataJson as Record<string, unknown>).comissao ===
              "object"
              ? (
                  (contract.dataJson as Record<string, unknown>).comissao as Record<
                    string,
                    unknown
                  >
                ).imobiliaria_nome ?? null
              : null,
          imobiliaria_cnpj:
            (contract.dataJson as Record<string, unknown> | null)?.comissao &&
            typeof (contract.dataJson as Record<string, unknown>).comissao ===
              "object"
              ? (
                  (contract.dataJson as Record<string, unknown>).comissao as Record<
                    string,
                    unknown
                  >
                ).imobiliaria_cnpj ?? null
              : null,
          walletId: account.walletId,
        } as Prisma.InputJsonValue,
      },
    });

    // Auto-promove deal pra "Cobrança emitida". Não retrocede se já passou —
    // criação de cobrança extra pra um deal em "Comissão paga" mantém stage.
    let stageMovedTo: string | null = null;
    {
      const dealWithStage = await prisma.deal.findUnique({
        where: { id: deal.id },
        include: { stage: true, pipeline: { include: { stages: true } } },
      });
      const cobrancaStage = dealWithStage?.pipeline.stages.find(
        (s) => s.name === "Cobrança emitida"
      );
      const linearOrder = [
        "Formulário",
        "Confecção de Contrato",
        "Enviado para assinatura",
        "Contrato assinado",
      ];
      if (
        dealWithStage &&
        cobrancaStage &&
        linearOrder.includes(dealWithStage.stage.name)
      ) {
        await prisma.deal.update({
          where: { id: dealWithStage.id },
          data: { stageId: cobrancaStage.id },
        });
        stageMovedTo = cobrancaStage.id;
      }
    }

    if (!input.skipAudit) {
      await audit(
        {
          orgId: input.orgId,
          userId: input.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
        {
          action: "CHARGE_CREATE",
          result: "SUCCESS",
          resourceType: "commission_charge",
          resource: `commission_charge:${charge.id}`,
          metadata: {
            dealId: deal.id,
            contractId: contract.id,
            asaasPaymentId: payment.id,
            value: payment.value,
            billingType: input.billingType,
            stageMovedTo,
            kind: input.kind ?? "commission",
            categoryLabel: input.categoryLabel ?? null,
            customSplitsCount: input.customSplits?.length ?? 0,
            hiddenSplitsCount: input.display?.hiddenRecipientIds.length ?? 0,
          },
        }
      );
    }

    // Régua: notifica owner do deal (e admins/comissionados conforme settings)
    void notifyChargeEvent({
      chargeId: charge.id,
      event: "created",
      orgId: input.orgId,
    });

    return {
      status: 200,
      body: {
        charge: {
          id: charge.id,
          asaasPaymentId: charge.asaasPaymentId,
          value: charge.value,
          billingType: charge.billingType,
          status: charge.status,
          dueDate: charge.currentDueDate,
          invoiceUrl: charge.invoiceUrl,
          bankSlipUrl: charge.bankSlipUrl,
          identificationField: charge.identificationField,
          pixQrCodePayload: charge.pixQrCodePayload,
          pixQrCodeImage: charge.pixQrCodeImage,
        },
      },
    };
  } catch (err) {
    if (!input.skipAudit) {
      await audit(
        {
          orgId: input.orgId,
          userId: input.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
        {
          action: "CHARGE_CREATE",
          result: "FAILURE",
          metadata: { error: err instanceof Error ? err.message : "unknown" },
        }
      );
    }
    if (err instanceof AsaasError) {
      return {
        status: 422,
        body: {
          error: "ASAAS_ERROR",
          details: err.errors,
          asaasStatus: err.status,
        },
      };
    }
    console.error("[charges-action]", err);
    return { status: 500, body: { error: "Falha ao criar cobrança" } };
  }
}

/**
 * Preview pra ActionIntent — calcula taxas, splits e payer info SEM chamar Asaas.
 * Idempotente / read-only.
 */
export interface ChargePreview {
  summary: string;
  details: {
    dealId: string;
    contractId: string;
    payer: { papel: string; nome: string };
    value: number;
    billingType: string;
    dueDate: string;
    splits: Array<{ walletId: string; percentual?: number; fixed?: number }>;
    platformFeePercent: number;
  };
}

export async function buildChargePreview(args: {
  dealId: string;
  orgId: string;
  accountId: string;
  contractId?: string;
  billingType: "PIX" | "BOLETO";
  dueDate: string;
}): Promise<ChargePreview | { error: string; status: number }> {
  const deal = await prisma.deal.findFirst({
    where: { id: args.dealId, pipeline: { orgId: args.orgId } },
    include: {
      contracts: {
        orderBy: { version: "desc" },
        take: 1,
        where: args.contractId ? { id: args.contractId } : { status: "aprovado" },
      },
    },
  });
  if (!deal) return { error: "Deal não encontrado", status: 404 };
  const contract = deal.contracts[0];
  if (!contract) {
    return { error: "Nenhum contrato aprovado neste deal", status: 422 };
  }

  const account = await prisma.asaasAccount.findFirst({
    where: { id: args.accountId, orgId: args.orgId, archivedAt: null },
  });
  if (!account) {
    return {
      error: "Conta Asaas inválida ou inacessível",
      status: 422,
    };
  }

  // Fase 1d: markup global (PlatformConfig) com override per-org (OrgFinancialSettings).
  const { platformFeePercent, platformWalletId: resolvedPlatformWalletId } =
    await resolvePlatformFee(args.orgId, account.id);
  const platformWalletId = resolvedPlatformWalletId ?? undefined;

  const data = contract.dataJson as unknown as DadosContratoLite;
  let payer;
  let value;
  let payload;
  try {
    payer = resolvePayer(data);
    value = resolveCommissionValue(data);
    payload = buildCommissionPayload({
      contractData: data,
      payer,
      value,
      billingType: args.billingType,
      dueDate: args.dueDate,
      description: "preview",
      externalReference: `contract:${contract.id}`,
      orgWalletId: account.walletId,
      platformFeePercent: platformFeePercent > 0 ? platformFeePercent : undefined,
      platformWalletId:
        platformFeePercent > 0 && platformWalletId ? platformWalletId : undefined,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Erro ao montar preview",
      status: 422,
    };
  }

  return {
    summary: `Criar cobrança ${args.billingType} de R$ ${(value / 100).toFixed(2)} para ${payer.papel} (${payer.nome ?? "?"})`,
    details: {
      dealId: deal.id,
      contractId: contract.id,
      payer: { papel: payer.papel, nome: payer.nome ?? "—" },
      value,
      billingType: args.billingType,
      dueDate: args.dueDate,
      splits:
        (payload.paymentInput.split as
          | Array<{
              walletId: string;
              percentualValue?: number;
              fixedValue?: number;
            }>
          | undefined)?.map((s) => ({
          walletId: s.walletId,
          percentual: s.percentualValue,
          fixed: s.fixedValue,
        })) ?? [],
      platformFeePercent,
    },
  };
}
