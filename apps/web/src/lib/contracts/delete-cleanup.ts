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
// ⚠️ ENUMERAÇÃO MANUAL de TODAS as colunas ESCALARES que guardam uma URL do NOSSO
// storage (Vercel Blob / S3). Não há registro central de blobs — são colunas
// string espalhadas por N models. AO ADICIONAR uma feature que persista uma blob
// URL numa coluna nova, INCLUA a contagem AQUI. Duas consequências de esquecer:
//   1. o delete de anexo compartilhado apaga um blob que a coluna nova serve
//      (reintroduz o 404 de blob compartilhado — bug do PR #150);
//   2. o cron de GC de órfãos (blob-gc) trata o blob como órfão e o APAGA.
//
// NÃO cobre blobs referenciados só em campos JSON/HTML (não dá pra `count` por
// coluna): `Inspection.ambientesJson` (fotos/áudio de vistoria, prefixo
// `inspections/`) e imagens de contrato embedadas no HTML (prefixo
// `contracts/<id>/images/`). Por isso o GC EXCLUI esses prefixos do sweep.
// Fonte ÚNICA das checagens de referência (uma por coluna de storage). Cada thunk
// conta rows que referenciam `url`. Usado por countBlobUrlReferences (paralelo,
// contagem exata — path de delete) E por isBlobReferenced (sequencial com
// short-circuit — o GC de órfãos, mais eficiente pro caso comum "referenciado").
const BLOB_REF_CHECKS: Array<(db: Db, url: string) => Promise<number>> = [
  // Anexos (compartilhados por referência entre si — o finalize copia a URL)
  (db, url) => db.dealAttachment.count({ where: { url } }),
  (db, url) => db.formAttachment.count({ where: { url } }),
  (db, url) => db.proposalAttachment.count({ where: { url } }),
  (db, url) => db.leaseClientAttachment.count({ where: { url } }),
  (db, url) => db.leadAttachment.count({ where: { url } }),
  (db, url) => db.chatAttachment.count({ where: { blobUrl: url } }),
  // Envelope ClickSign: PDF enviado E o assinado (legalmente crítico) — o
  // assinado é espelhado como DealAttachment com a MESMA url (signed-pdf.ts).
  (db, url) =>
    db.envelope.count({
      where: { OR: [{ documentUrl: url }, { signedDocumentUrl: url }] },
    }),
  // Artefatos derivados / docs com coluna própria (NÃO estavam no ref-check
  // original — o GC os apagaria como órfãos sem estas contagens):
  (db, url) => db.inspection.count({ where: { laudoPdfUrl: url } }), // laudo vistoria
  (db, url) => db.export.count({ where: { url } }), // PDF/DOCX exportado
  (db, url) => db.document.count({ where: { s3Url: url } }), // /documents/upload
  (db, url) => db.proposal.count({ where: { dossierUrl: url } }), // dossiê proposta
  (db, url) => db.guarantee.count({ where: { documentoPdfUrl: url } }), // garantia
  (db, url) => db.insurancePolicy.count({ where: { pdfUrl: url } }), // apólice seguro
  (db, url) => db.dimobExport.count({ where: { fileUrl: url } }), // TXT fiscal DIMOB
  (db, url) =>
    db.brandingSettings.count({
      where: { OR: [{ logoUrl: url }, { faviconUrl: url }] },
    }), // logo/favicon de branding
  (db, url) => db.orgFinancialSettings.count({ where: { brandLogoUrl: url } }), // logo legado
];

export async function countBlobUrlReferences(db: Db, url: string): Promise<number> {
  if (!url) return 0;
  const counts = await Promise.all(BLOB_REF_CHECKS.map((f) => f(db, url)));
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Existe alguma row referenciando este blob URL? Short-circuit — para na primeira
 * coluna que casa (barato pro caso comum "referenciado"). Semanticamente
 * equivalente a `countBlobUrlReferences(...) > 0`, mas sem contar tudo. Usado
 * pelo GC de órfãos, que checa milhares de blobs.
 *
 * Um ÓRFÃO paga as N checagens em série (nenhuma casa). É de propósito: no GC,
 * órfão é RARO por design (só o resíduo TOCTOU), então o caso comum
 * (referenciado, short-circuit rápido) domina; paralelizar encareceria o comum.
 */
export async function isBlobReferenced(db: Db, url: string): Promise<boolean> {
  if (!url) return false;
  for (const f of BLOB_REF_CHECKS) {
    if ((await f(db, url)) > 0) return true;
  }
  return false;
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
    if (await isBlobReferenced(db, url)) return "kept";
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
  // Concorrência limitada. CADA URL faz fan-out de 8 count queries + 1 delete,
  // então o total em voo é ~9×CONCURRENCY. Com CONCURRENCY=3 são ~27 queries
  // simultâneas por lote — o suficiente pra não serializar O(N) o delete de um
  // deal com dezenas de anexos (estouraria o orçamento do waitUntil), mas sem
  // saturar o pool do Neon como faria um lote de 5 (45 em voo).
  const CONCURRENCY = 3;
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
