import { prisma } from "@/lib/db/prisma";
import { createTransfer } from "@/lib/asaas/transfers";
import { getAccountWithApiKey } from "@/lib/asaas/account";
import { audit } from "@/lib/security/audit";

// Dispatcher de AsaasTransfer status="PENDING_DISPATCH" → POST /transfers Asaas.
// Roda via cron a cada 10min. Atualiza status PENDING/DONE/FAILED + asaasTransferId.
// Idempotência: filtramos só status="PENDING_DISPATCH" (única transição válida).

export interface DispatchResult {
  scanned: number;
  dispatched: number;
  failed: number;
  skipped: number;
}

const MAX_BATCH = 50;

export async function dispatchPendingTransfers(): Promise<DispatchResult> {
  const result: DispatchResult = { scanned: 0, dispatched: 0, failed: 0, skipped: 0 };

  const pending = await prisma.asaasTransfer.findMany({
    where: { status: "PENDING_DISPATCH" },
    orderBy: { scheduledDate: "asc" },
    take: MAX_BATCH,
  });
  result.scanned = pending.length;

  for (const t of pending) {
    if (!t.accountId) {
      result.skipped++;
      continue;
    }
    if (!t.pixAddressKey || !t.pixKeyType) {
      // TED não suportado nesta versão — pula. Fica como skipped.
      result.skipped++;
      continue;
    }

    try {
      const { apiKey } = await getAccountWithApiKey(t.accountId);
      const created = await createTransfer({
        input: {
          value: t.value,
          description: t.description ?? undefined,
          pixAddressKey: t.pixAddressKey,
          pixAddressKeyType: t.pixKeyType as "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP",
        },
        apiKey,
      });

      await prisma.asaasTransfer.update({
        where: { id: t.id },
        data: {
          asaasTransferId: created.id,
          status: created.status,
          netValue: created.netValue,
          transferFee: created.transferFee,
          effectiveDate: created.effectiveDate ? new Date(created.effectiveDate) : null,
        },
      });

      await audit(
        { orgId: t.orgId, userId: null },
        {
          action: "TRANSFER_INIT",
          result: "SUCCESS",
          resource: t.id,
          resourceType: "AsaasTransfer",
          metadata: {
            via: "dispatcher",
            asaasTransferId: created.id,
            value: t.value,
            status: created.status,
          },
        }
      );

      result.dispatched++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await prisma.asaasTransfer.update({
        where: { id: t.id },
        data: {
          status: "FAILED",
          failureReason: reason.slice(0, 500),
        },
      });
      await audit(
        { orgId: t.orgId, userId: null },
        {
          action: "TRANSFER_DENIED",
          result: "FAILURE",
          resource: t.id,
          resourceType: "AsaasTransfer",
          metadata: { via: "dispatcher", error: reason.slice(0, 200) },
        }
      );
      result.failed++;
    }
  }

  return result;
}
