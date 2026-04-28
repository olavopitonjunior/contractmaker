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
import { decryptSecret } from "@/lib/security/crypto";
import { createTransfer } from "./transfers";
import { AsaasError } from "./errors";
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

  // Carrega Asaas account + settings da org
  const [account, settings] = await Promise.all([
    prisma.asaasAccount.findUnique({ where: { orgId: charge.orgId } }),
    prisma.orgFinancialSettings.findUnique({ where: { orgId: charge.orgId } }),
  ]);
  if (!account) return result;

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

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
    if (entry.recipientId) {
      const exists = await prisma.splitRecipient.findUnique({
        where: { id: entry.recipientId },
        select: { id: true },
      });
      if (exists) splitRecipientFk = exists.id;
    }

    // Idempotência: tenta criar registro local com unique key.
    // Se já existe (P2002), pulamos. Outros erros logamos.
    let localTransfer;
    try {
      localTransfer = await prisma.asaasTransfer.create({
        data: {
          orgId: charge.orgId,
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
        await prisma.orgFinancialSettings
          .update({
            where: { orgId: charge.orgId },
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

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: transfer.orgId },
  });
  if (!account) return { ok: false, reason: "Conta Asaas não encontrada" };

  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

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
