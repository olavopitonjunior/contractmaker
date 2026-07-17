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

/**
 * Conta quantas rows do banco ainda referenciam este blob URL.
 *
 * Um mesmo blob é COMPARTILHADO por referência entre tabelas: o finalize do form
 * copia `FormAttachment.url` pro `DealAttachment.url` (sem re-upload), a conversão
 * de proposta copia `ProposalAttachment.url`, e a esteira de locação copia
 * `LeaseClientAttachment.url` — todos apontando pro MESMO objeto no storage. Além
 * disso, re-finalizar um form gera `DealAttachment` duplicados com a mesma URL.
 * Por isso apagar o blob ao deletar UMA row órfãva o arquivo de todas as irmãs
 * (bug: matrícula/IPTU davam 404 no download). Conte antes de apagar.
 */
export async function countBlobUrlReferences(db: Db, url: string): Promise<number> {
  if (!url) return 0;
  const [deal, form, proposal, leaseClient, lead, envelope, inspection, chat] =
    await Promise.all([
      db.dealAttachment.count({ where: { url } }),
      db.formAttachment.count({ where: { url } }),
      db.proposalAttachment.count({ where: { url } }),
      db.leaseClientAttachment.count({ where: { url } }),
      db.leadAttachment.count({ where: { url } }),
      // Envelope ClickSign: o PDF assinado é gravado em `signedDocumentUrl` E
      // espelhado como DealAttachment com a MESMA url (signed-pdf.ts). Deletar o
      // anexo espelho NÃO pode apagar o blob que o envelope ainda serve no botão
      // "Baixar assinado" — senão perde-se um contrato assinado legalmente.
      db.envelope.count({
        where: { OR: [{ documentUrl: url }, { signedDocumentUrl: url }] },
      }),
      // Laudo de vistoria (locação): a versão assinada vira `Inspection.laudoPdfUrl`
      // apontando pro mesmo blob do envelope/anexo.
      db.inspection.count({ where: { laudoPdfUrl: url } }),
      // ChatAttachment usa `blobUrl` — namespace próprio, mas incluído por
      // completude (o delete de contrato trata blobUrl como apagável).
      db.chatAttachment.count({ where: { blobUrl: url } }),
    ]);
  return (
    deal + form + proposal + leaseClient + lead + envelope + inspection + chat
  );
}

/**
 * Apaga o blob do storage SÓ se nenhuma outra row ainda o referencia. Chame
 * DEPOIS de deletar a row (a row já deletada não se conta). Best-effort: nunca
 * lança. Retorna "deleted" | "kept" (ainda referenciado) | "skipped" (url vazia
 * ou storage não removeu).
 */
export async function deleteBlobIfUnreferenced(
  db: Db,
  url: string | null | undefined
): Promise<"deleted" | "kept" | "skipped"> {
  if (!url) return "skipped";
  try {
    if ((await countBlobUrlReferences(db, url)) > 0) return "kept";
    const { deleteFromStorage } = await import("@/lib/storage/s3");
    return (await deleteFromStorage(url)) ? "deleted" : "skipped";
  } catch {
    // best-effort — órfão residual é preferível a falhar o delete
    return "skipped";
  }
}

/**
 * Deleta blobs do storage best-effort (pós-commit), pulando os que ainda são
 * referenciados por outra row (ref-count via `countBlobUrlReferences`). Nunca
 * lança. Chame DEPOIS do commit que removeu as rows-alvo.
 */
export async function deleteBlobs(urls: string[], db: Db): Promise<number> {
  if (urls.length === 0) return 0;
  // Concorrência limitada: cada URL dispara 8 count queries + 1 delete. Em batch
  // grande (delete de deal com dezenas de anexos) o loop serial O(N) poderia
  // estourar o orçamento do waitUntil e deixar blobs sem avaliar. Processa em
  // lotes de CONCURRENCY sem inundar o pool do Neon.
  const CONCURRENCY = 5;
  let deleted = 0;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((url) => deleteBlobIfUnreferenced(db, url))
    );
    deleted += outcomes.filter((o) => o === "deleted").length;
  }
  return deleted;
}
