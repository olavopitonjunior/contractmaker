import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Limpeza de recursos que a cascata do Prisma NÃO cobre ao deletar contratos:
 *
 *  - **ContractMemory**: não tem FK pra Contract (só `contractId` solto), então
 *    sobrevive ao delete e continua sendo recuperada por find_similar_contracts
 *    (escopo só por org) — vazando nome/estado civil/valor das partes pra chats
 *    de OUTROS deals. Precisa ser deletada explicitamente.
 *  - **Blobs órfãos**: ChatAttachment.blobUrl e Envelope.documentUrl/
 *    signedDocumentUrl (PDFs assinados) cascateiam as ROWS mas deixam o blob no
 *    storage pra sempre (RG/CNH, contratos assinados).
 */

/** Coleta os blob URLs órfãos de um conjunto de contratos (antes do delete). */
export async function collectContractBlobUrls(
  db: Db,
  contractIds: string[]
): Promise<string[]> {
  if (contractIds.length === 0) return [];
  const [chatAttachments, envelopes] = await Promise.all([
    db.chatAttachment.findMany({
      where: { session: { contractId: { in: contractIds } } },
      select: { blobUrl: true },
    }),
    db.envelope.findMany({
      where: { contractId: { in: contractIds } },
      select: { documentUrl: true, signedDocumentUrl: true },
    }),
  ]);
  const urls: string[] = [];
  for (const a of chatAttachments) if (a.blobUrl) urls.push(a.blobUrl);
  for (const e of envelopes) {
    if (e.documentUrl) urls.push(e.documentUrl);
    if (e.signedDocumentUrl) urls.push(e.signedDocumentUrl);
  }
  return urls;
}

/** Deleta as ContractMemory dos contratos (dentro da transação de delete). */
export async function deleteContractMemories(
  tx: Db,
  contractIds: string[]
): Promise<number> {
  if (contractIds.length === 0) return 0;
  const res = await tx.contractMemory.deleteMany({
    where: { contractId: { in: contractIds } },
  });
  return res.count;
}

/** Deleta blobs do storage best-effort (pós-commit). Nunca lança. */
export async function deleteBlobs(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;
  const { deleteFromStorage } = await import("@/lib/storage/s3");
  let deleted = 0;
  for (const url of urls) {
    try {
      if (await deleteFromStorage(url)) deleted++;
    } catch {
      // best-effort — órfão residual é preferível a falhar o delete
    }
  }
  return deleted;
}
