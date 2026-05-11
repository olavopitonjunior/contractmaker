/**
 * Split dispatcher (Fase 6) — quando uma CommissionCharge é paga (PAYMENT_RECEIVED),
 * dispara transferências PIX para os splits externos persistidos em
 * `splitJson.external`.
 *
 * Idempotência: AsaasTransfer tem @@unique([commissionChargeId, splitRecipientId]).
 * Concorrência: rodamos UMA chamada Asaas por entry, sequencialmente — evita
 * race em saldo.
 *
 * Estados:
 *   - PENDING_DISPATCH: registro local criado, ainda não chamou Asaas.
 *   - PENDING / DONE / FAILED: estados do Asaas após chamada.
 *
 * Fire-and-forget: webhook handler chama `void dispatchExternalSplits(chargeId)`.
 * Erros não propagam. Cada falha individual é logada em AsaasTransfer.failureReason
 * para o admin re-tentar manualmente via UI.
 */

import { prisma } from "@/lib/db/prisma";
import { createTransfer } from "./transfers";
import { AsaasError } from "./errors";
import { getAccountWithApiKey } from "./account";
import type { ExternalSplit } from "./commission";

interface ChargeSplitJson {
  splits?: unknown[];
  external?: ExternalSplit[];
}

/**
 * Calcula o valor a transferir para cada split externo.
 * Base = netValue (após taxa Asaas) se disponível, senão value (gross).
 */
function computeAmount(
  base: number,
  entry: ExternalSplit,
  feeAdjustment: number
): number {
  const fixedPart = entry.fixedValue ?? 0;
  const pctPart = entry.percentualValue ? (entry.percentualValue / 100) * base : 0;
  const raw = fixedPart + pctPart;
  const adjusted = raw - feeAdjustment;
  // Clamp negativo (se taxa for maior que o valor, transferência seria negativa)
  return Math.max(0, Math.round(adjusted * 100) / 100);
}

export interface DispatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ recipientId: string; reason: string }>;
}

export async function dispatchExternalSplits(
  chargeId: string
): Promise<DispatchResult> {
  const result: DispatchResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const charge = await prisma.commissionCharge.findUnique({
    where: { id: chargeId },
  });
  if (!charge) return result;

  const splitJson = (charge.splitJson ?? null) as ChargeSplitJson | null;
  const externals = splitJson?.external ?? [];
  if (externals.length === 0) return result;

  // Resolve a conta que emitiu a charge (accountId persistido na criação).
  // Sem accountId = charge legado pré-multi-account; cai no fallback de buscar
  // a única conta da org.
  let resolvedAccountId = charge.accountId;
  if (!resolvedAccountId) {
    const fallback = await prisma.asaasAccount.findFirst({
      where: { orgId: charge.orgId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) return result;
    resolvedAccountId = fallback.id;
  }

  const { account, apiKey } = await getAccountWithApiKey(resolvedAccountId);

  // Settings: prefer per-account, fallback to legacy org-level (accountId=null)
  const settings =
    (await prisma.orgFinancialSettings.findUnique({
      where: { accountId: account.id },
    })) ??
    (await prisma.orgFinancialSettings.findFirst({
      where: { orgId: charge.orgId, accountId: null },
    }));

  const base = charge.netValue ?? charge.value;
  const feePolicy = settings?.pixSplitFeePolicy ?? "org_absorbs";
  // Taxa estimada lida do último valor observado (em centavos), atualizada
  // automaticamente após cada transferência DONE com transferFee retornado.
  // Default 100 centavos (R$ 1,00) na criação da OrgFinancialSettings.
  const observedFeeCents = settings?.lastObservedPixFeeCents ?? 100;
  const feeAdjustment =
    feePolicy === "deduct_from_recipient" ? observedFeeCents / 100 : 0;

  for (const entry of externals) {
    result.attempted++;

    // entry.recipientId pode ser:
    //   (a) cuid de um SplitRecipient cadastrado, OU
    //   (b) string arbitrária pra pix_external one-shot (sem cadastro prévio).
    // No caso (b), splitRecipientId tem que ir como NULL (FK viola senão).
    let splitRecipientFk: string | null = null;
    let recipientPending: string[] = [];
    let recipientInactive = false;
    if (entry.recipientId) {
      const exists = await prisma.splitRecipient.findUnique({
        where: { id: entry.recipientId },
        select: { id: true, pendingFields: true, active: true },
      });
      if (exists) {
        splitRecipientFk = exists.id;
        recipientPending = exists.pendingFields ?? [];
        recipientInactive = !exists.active;
      }
    }

    // Pagadoria v2 — rascunho de SplitRecipient: pula dispatch e marca como
    // FAILED com motivo claro. Cobrança continua emitida normalmente; admin
    // pode completar cadastro via UI ou magic link e re-tentar transfer.
    if (recipientPending.length > 0 || recipientInactive) {
      const reason =
        recipientPending.length > 0
          ? `Cadastro pendente — campos faltando: ${recipientPending.join(", ")}. Complete via /settings/pagamentos/split-recipients ou magic link.`
          : "Destinatário inativo — reative ou edite o split.";
      try {
        await prisma.asaasTransfer.create({
          data: {
            orgId: charge.orgId,
            accountId: account.id,
            commissionChargeId: charge.id,
            splitRecipientId: splitRecipientFk,
            asaasTransferId: null,
            value: computeAmount(base, entry, feeAdjustment),
            type: "PIX",
            status: "FAILED",
            pixAddressKey: entry.pixAddressKey,
            pixKeyType: entry.pixKeyType,
            ownerName: entry.ownerName,
            ownerCpfCnpj: entry.ownerCpfCnpj,
            origin: "split_dispatch",
            description: `Split de ${charge.id} — ${entry.label ?? entry.ownerName} (cadastro pendente)`,
            failureReason: reason.slice(0, 1000),
          },
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "P2002") {
          console.error(
            `[splitDispatcher] failed to mark draft transfer for ${charge.id}/${entry.recipientId}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      result.skipped++;
      result.errors.push({ recipientId: entry.recipientId, reason });
      continue;
    }

    // Idempotência: tenta criar registro local com unique key.
    // Se já existe (P2002), pulamos. Outros erros logamos.
    let localTransfer;
    try {
      localTransfer = await prisma.asaasTransfer.create({
        data: {
          orgId: charge.orgId,
          accountId: account.id,
          commissionChargeId: charge.id,
          splitRecipientId: splitRecipientFk,
          asaasTransferId: null,
          value: computeAmount(base, entry, feeAdjustment),
          type: "PIX",
          status: "PENDING_DISPATCH",
          pixAddressKey: entry.pixAddressKey,
          pixKeyType: entry.pixKeyType,
          ownerName: entry.ownerName,
          ownerCpfCnpj: entry.ownerCpfCnpj,
          origin: "split_dispatch",
          description: `Split de ${charge.id} — ${entry.label ?? entry.ownerName}`,
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        result.skipped++;
        continue;
      }
      console.error(
        `[splitDispatcher] failed to create local AsaasTransfer for charge ${charge.id} recipient ${entry.recipientId}:`,
        err instanceof Error ? err.message : err
      );
      result.failed++;
      result.errors.push({
        recipientId: entry.recipientId,
        reason: err instanceof Error ? err.message : "Erro ao criar transfer local",
      });
      continue;
    }

    if (localTransfer.value <= 0) {
      await prisma.asaasTransfer.update({
        where: { id: localTransfer.id },
        data: {
          status: "FAILED",
          failureReason: "Valor calculado é zero ou negativo após taxas",
        },
      });
      result.failed++;
      result.errors.push({
        recipientId: entry.recipientId,
        reason: "Valor zerado",
      });
      continue;
    }

    // Chama Asaas
    try {
      const asaas = await createTransfer({
        input: {
          value: localTransfer.value,
          description: localTransfer.description ?? undefined,
          pixAddressKey: entry.pixAddressKey,
          pixAddressKeyType: entry.pixKeyType as
            | "CPF"
            | "CNPJ"
            | "EMAIL"
            | "PHONE"
            | "EVP",
        },
        apiKey,
      });
      await prisma.asaasTransfer.update({
        where: { id: localTransfer.id },
        data: {
          asaasTransferId: asaas.id,
          status: asaas.status,
          netValue: asaas.netValue ?? null,
          transferFee: asaas.transferFee ?? null,
          effectiveDate: asaas.effectiveDate ? new Date(asaas.effectiveDate) : null,
          scheduledDate: asaas.scheduledDate ? new Date(asaas.scheduledDate) : null,
        },
      });

      // Atualiza estimativa para próximas cobranças (apenas quando taxa
      // foi efetivamente cobrada). transferFee em reais → centavos.
      if (typeof asaas.transferFee === "number" && asaas.transferFee > 0) {
        const cents = Math.round(asaas.transferFee * 100);
        // Per-account: atualiza settings da conta que emitiu a charge.
        await prisma.orgFinancialSettings
          .update({
            where: { accountId: account.id },
            data: { lastObservedPixFeeCents: cents },
          })
          .catch(() => {
            /* settings pode não existir — ignora silenciosamente */
          });
      }

      result.succeeded++;
    } catch (err) {
      const reason =
        err instanceof AsaasError
          ? err.errors.map((e) => e.description).join("; ")
          : err instanceof Error
            ? err.message
            : "Erro desconhecido";
      await prisma.asaasTransfer.update({
        where: { id: localTransfer.id },
        data: {
          status: "FAILED",
          failureReason: reason.slice(0, 1000),
        },
      });
      result.failed++;
      result.errors.push({ recipientId: entry.recipientId, reason });
    }
  }

  return result;
}

/**
 * Re-dispatch de uma transferência failed específica.
 * Botão "Tentar novamente" no UI chama este helper.
 */
export async function retryFailedTransfer(transferId: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const transfer = await prisma.asaasTransfer.findUnique({
    where: { id: transferId },
  });
  if (!transfer) return { ok: false, reason: "Transferência não encontrada" };
  if (transfer.status !== "FAILED") {
    return { ok: false, reason: `Status atual é ${transfer.status} — só FAILED pode ser retried` };
  }
  if (!transfer.commissionChargeId || !transfer.splitRecipientId) {
    return {
      ok: false,
      reason: "Transferência sem vínculo de cobrança/recipient — use o flow manual",
    };
  }
  if (!transfer.pixAddressKey || !transfer.pixKeyType) {
    return { ok: false, reason: "Dados de PIX faltando" };
  }

  // Conta resolvida via transfer.accountId (persistido na criação). Fallback
  // pra primeira conta da org pra transfers legados pré-multi-account.
  let resolvedAccountId = transfer.accountId;
  if (!resolvedAccountId) {
    const fallback = await prisma.asaasAccount.findFirst({
      where: { orgId: transfer.orgId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) return { ok: false, reason: "Conta Asaas não encontrada" };
    resolvedAccountId = fallback.id;
  }
  const { apiKey } = await getAccountWithApiKey(resolvedAccountId);

  try {
    const asaas = await createTransfer({
      input: {
        value: transfer.value,
        description: transfer.description ?? undefined,
        pixAddressKey: transfer.pixAddressKey,
        pixAddressKeyType: transfer.pixKeyType as
          | "CPF"
          | "CNPJ"
          | "EMAIL"
          | "PHONE"
          | "EVP",
      },
      apiKey,
    });
    await prisma.asaasTransfer.update({
      where: { id: transfer.id },
      data: {
        asaasTransferId: asaas.id,
        status: asaas.status,
        netValue: asaas.netValue ?? null,
        transferFee: asaas.transferFee ?? null,
        failureReason: null,
        effectiveDate: asaas.effectiveDate ? new Date(asaas.effectiveDate) : null,
      },
    });
    return { ok: true };
  } catch (err) {
    const reason =
      err instanceof AsaasError
        ? err.errors.map((e) => e.description).join("; ")
        : err instanceof Error
          ? err.message
          : "Erro desconhecido";
    await prisma.asaasTransfer.update({
      where: { id: transfer.id },
      data: { failureReason: reason.slice(0, 1000) },
    });
    return { ok: false, reason };
  }
}
