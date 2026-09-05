/**
 * Ponto ÚNICO que exclui anexo — de deal, de formulário ou de proposta.
 *
 * Regra do produto: o sistema não apaga nada automaticamente e nenhuma
 * exclusão pode ficar sem rastro. Toda exclusão passa por aqui, que arquiva a
 * linha em `DeletedAttachment` e apaga a original **na mesma transação**. Ou as
 * duas coisas acontecem, ou nenhuma — não existe estado "sumiu sem registro".
 *
 * O blob no storage NÃO é tocado. Antes, o delete chamava
 * `deleteBlobIfUnreferenced` e o objeto ia embora junto com a última linha que
 * o referenciava, o que tornava a exclusão irreversível na prática (foi o que
 * impediu recuperar o documento do caso que originou este trabalho). Agora o
 * objeto sobrevive, e `DeletedAttachment.url` entra em `BLOB_REF_CHECKS`
 * (`lib/contracts/delete-cleanup.ts`) pra que nada o trate como órfão.
 *
 * Por que o registro aqui e não só `audit()`: `audit()` engole exceção por
 * design (`lib/security/audit.ts`), então falha de escrita dele deixaria o
 * anexo apagado e sem rastro. O audit continua sendo emitido pelos callers,
 * como índice pesquisável — a garantia é esta linha.
 */

import { Prisma } from "@prisma/client";

/** Cliente Prisma ou o `tx` de uma `$transaction`. */
type Db = Prisma.TransactionClient;

export type ArchiveOrigin = "deal" | "form" | "proposal";
export type ArchiveVia =
  | "ui_deal"
  | "ui_form"
  | "ui_proposal"
  // O próprio LEAD removeu um documento que subiu pela página pública da
  // proposta (`/p/[token]`, 2026-09). Sem sessão — `userId` fica null.
  | "public_proposal"
  | "deal_delete"
  | "certidao";

interface AttachmentRowLike {
  id: string;
  filename: string;
  url: string;
  category?: string | null;
  dealId?: string | null;
  formId?: string | null;
  proposalId?: string | null;
}

export interface ArchiveArgs {
  /** Linha original completa — vai inteira pro `payload` do arquivo. */
  row: AttachmentRowLike & Record<string, unknown>;
  origin: ArchiveOrigin;
  via: ArchiveVia;
  /** Org dona — `Deal` não tem orgId direto, resolver por `pipeline.orgId`. */
  orgId: string;
  /** Null em rota pública/anônima. */
  userId?: string | null;
  ipAddress?: string | null;
}

/**
 * Arquiva e apaga. Chamar SEMPRE dentro de uma `$transaction` — o parâmetro
 * `db` existe pra isso. Devolve o id da linha arquivada.
 */
export async function archiveAttachment(
  db: Db,
  args: ArchiveArgs
): Promise<string> {
  const { row, origin, via, orgId, userId, ipAddress } = args;

  const archived = await db.deletedAttachment.create({
    data: {
      orgId,
      origin,
      originalId: row.id,
      dealId: row.dealId ?? null,
      formId: row.formId ?? null,
      proposalId: row.proposalId ?? null,
      filename: row.filename,
      url: row.url,
      category: row.category ?? null,
      // `as Prisma.InputJsonValue`: a linha vem do Prisma com Date/Decimal, que
      // o driver serializa. Datas viram string ISO no payload — o restore
      // reconstrói só os campos que o create precisa, então isso é aceitável.
      payload: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
      deletedByUserId: userId ?? null,
      deletedVia: via,
      ipAddress: ipAddress ?? null,
    },
    select: { id: true },
  });

  if (origin === "deal") {
    await db.dealAttachment.delete({ where: { id: row.id } });
  } else if (origin === "proposal") {
    await db.proposalAttachment.delete({ where: { id: row.id } });
  } else {
    await db.formAttachment.delete({ where: { id: row.id } });
  }

  return archived.id;
}

/**
 * Versão em lote pro delete de deal inteiro, onde os anexos caem por cascata
 * do FK. Arquiva TODOS antes de a cascata rodar — sem isto, apagar o negócio
 * levava os documentos sem deixar registro individual (o audit de `DEAL_DELETE`
 * nem os ids guardava).
 */
export async function archiveDealAttachmentsBeforeCascade(
  db: Db,
  args: { dealId: string; orgId: string; userId?: string | null; ipAddress?: string | null }
): Promise<number> {
  const rows = await db.dealAttachment.findMany({
    where: { dealId: args.dealId },
  });
  if (rows.length === 0) return 0;

  await db.deletedAttachment.createMany({
    data: rows.map((row) => ({
      orgId: args.orgId,
      origin: "deal",
      originalId: row.id,
      dealId: row.dealId,
      formId: null,
      filename: row.filename,
      url: row.url,
      category: row.category,
      payload: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
      deletedByUserId: args.userId ?? null,
      deletedVia: "deal_delete",
      ipAddress: args.ipAddress ?? null,
    })),
  });

  // Sem delete explícito: quem chama apaga o Deal em seguida e a cascata
  // `Deal → DealAttachment` leva as linhas. O arquivo já está gravado.
  return rows.length;
}
