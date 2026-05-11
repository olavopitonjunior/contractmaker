/**
 * Conciliação bancária — ingesta do extrato Asaas e match com CommissionCharge.
 *
 * Fluxo:
 *  1. ingestFinancialTransactions(orgId, startDate, finishDate) — busca extrato
 *     Asaas, upsert em BankReconciliation (dedupe por financialTransactionId)
 *  2. autoMatch() — para cada transaction PAYMENT_RECEIVED com asaasPaymentId
 *     match exato com CommissionCharge.asaasPaymentId → status=matched
 *  3. Manual: matchToCharge(reconciliationId, chargeId) via UI
 */

import { prisma } from "@/lib/db/prisma";
import { listFinancialTransactions, type AsaasFinancialTransaction } from "./finance";
import { sha256Hex } from "@/lib/security/crypto";

function makeTxId(t: AsaasFinancialTransaction): string {
  // Se Asaas deu id próprio, usa. Senão hash de (date+type+value+paymentId+desc).
  if (t.id) return t.id;
  return (
    "synth_" +
    sha256Hex(
      [t.date, t.type, t.value, t.paymentId ?? "", t.description ?? ""].join("|")
    ).slice(0, 16)
  );
}

export interface IngestResult {
  fetched: number;
  inserted: number;
  updated: number;
  autoMatched: number;
  skipped: number;
}

export async function ingestFinancialTransactions(params: {
  orgId: string;
  /** Conta Asaas cujo extrato foi consultado — persistido em BankReconciliation. */
  accountId: string;
  apiKey: string;
  startDate?: string;
  finishDate?: string;
}): Promise<IngestResult> {
  const res = await listFinancialTransactions({
    apiKey: params.apiKey,
    query: {
      startDate: params.startDate,
      finishDate: params.finishDate,
      limit: 100,
      order: "desc",
    },
  });

  let inserted = 0;
  let updated = 0;
  let autoMatched = 0;
  let skipped = 0;

  for (const t of res.data) {
    const txId = makeTxId(t);

    // Dedupe check
    const existing = await prisma.bankReconciliation.findUnique({
      where: {
        orgId_financialTransactionId: {
          orgId: params.orgId,
          financialTransactionId: txId,
        },
      },
    });

    // Auto-match via asaasPaymentId exato
    let matchedChargeId: string | null = null;
    let matchStatus: "matched" | "pending" = "pending";

    if (t.paymentId && t.type === "PAYMENT_RECEIVED") {
      const charge = await prisma.commissionCharge.findUnique({
        where: { asaasPaymentId: t.paymentId },
        select: { id: true, orgId: true },
      });
      if (charge && charge.orgId === params.orgId) {
        matchedChargeId = charge.id;
        matchStatus = "matched";
      }
    }

    if (existing) {
      // Só atualiza se status mudou de pending para matched
      if (existing.status === "pending" && matchStatus === "matched") {
        await prisma.bankReconciliation.update({
          where: { id: existing.id },
          data: {
            matchedChargeId,
            status: "matched",
            matchedAt: new Date(),
          },
        });
        updated += 1;
        autoMatched += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    await prisma.bankReconciliation.create({
      data: {
        orgId: params.orgId,
        accountId: params.accountId,
        financialTransactionId: txId,
        type: t.type,
        value: t.value,
        date: new Date(t.date),
        description: t.description ?? null,
        asaasPaymentId: t.paymentId ?? null,
        matchedChargeId,
        status: matchStatus,
        matchedAt: matchStatus === "matched" ? new Date() : null,
      },
    });
    inserted += 1;
    if (matchStatus === "matched") autoMatched += 1;
  }

  return {
    fetched: res.data.length,
    inserted,
    updated,
    autoMatched,
    skipped,
  };
}
