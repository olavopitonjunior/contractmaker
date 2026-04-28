/**
 * Sincroniza status de uma AsaasTransfer local com o estado real no Asaas.
 * Útil quando webhook não atualizou (ex: bug fire-and-forget pré-fix).
 *
 * Uso: npx tsx scripts/sync-transfer-status.ts --transfer-id <local id>
 */
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/security/crypto";

async function main() {
  const idx = process.argv.indexOf("--transfer-id");
  const id = idx >= 0 ? process.argv[idx + 1] : null;
  if (!id) {
    console.error("Use --transfer-id <local id>");
    process.exit(1);
  }
  const p = new PrismaClient();
  try {
    const t = await p.asaasTransfer.findUnique({ where: { id } });
    if (!t) {
      console.error("Transfer not found");
      process.exit(1);
    }
    if (!t.asaasTransferId) {
      console.error("AsaasTransfer sem asaasTransferId — nada a sincronizar");
      process.exit(1);
    }
    const account = await p.asaasAccount.findFirst({ where: { orgId: t.orgId } });
    if (!account) throw new Error("AsaasAccount not found");
    const apiKey = decryptSecret({
      ciphertext: account.apiKeyEncrypted,
      iv: account.apiKeyIvBase64,
      tag: account.apiKeyTagBase64,
    });
    const baseUrl =
      process.env.ASAAS_ENV === "production"
        ? "https://api.asaas.com/v3"
        : "https://api-sandbox.asaas.com/v3";
    const res = await fetch(`${baseUrl}/transfers/${t.asaasTransferId}`, {
      headers: { access_token: apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`Asaas HTTP ${res.status}`);
      process.exit(1);
    }
    const remote = (await res.json()) as {
      status: string;
      netValue?: number;
      transferFee?: number;
      effectiveDate?: string | null;
      scheduleDate?: string | null;
      failReason?: string | null;
    };
    console.log(`Local: ${t.status} → Remote: ${remote.status}`);
    const updated = await p.asaasTransfer.update({
      where: { id: t.id },
      data: {
        status: remote.status,
        netValue: remote.netValue ?? t.netValue,
        transferFee: remote.transferFee ?? t.transferFee,
        effectiveDate: remote.effectiveDate ? new Date(remote.effectiveDate) : t.effectiveDate,
        scheduledDate: remote.scheduleDate ? new Date(remote.scheduleDate) : t.scheduledDate,
        failureReason: remote.failReason ?? null,
      },
    });
    console.log("UPDATED:", JSON.stringify({ id: updated.id, status: updated.status, effectiveDate: updated.effectiveDate }, null, 2));
  } finally {
    await p.$disconnect();
  }
}
main().catch(console.error);
