import { createHash } from "crypto";
import type { LeaseClientAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Registro de documentos na ficha do cliente/prospect de locação
 * (LeaseClientAttachment). Espelha lib/deals/attachments.ts, mas escopado por
 * `leaseClientId` em vez de `dealId` — porque DealAttachment.dealId é NOT NULL e
 * não aceita anexo sem deal. Usado por:
 *   - upload manual (UI da ficha do cliente);
 *   - executor de certidões/Serasa (PDF gerado, via `certidaoJobId`).
 */

export function computeContentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface PersistLeaseClientDocumentArgs {
  leaseClientId: string;
  /** Buffer do arquivo — usado pra contentHash/byteSize (não re-sobe ao storage). */
  buffer: Buffer;
  /** URL já no storage (Blob/S3) — o upload é feito pelo caller. */
  url: string;
  filename: string;
  mime: string;
  category?: string | null;
  /** Liga o anexo ao job de certidão/serasa que o gerou (quando aplicável). */
  certidaoJobId?: string | null;
}

/**
 * Cria o LeaseClientAttachment (idempotente por conteúdo). Se já existir anexo
 * com o mesmo `contentHash` no cliente, devolve o existente com `deduped: true`.
 */
export async function persistLeaseClientDocument(
  args: PersistLeaseClientDocumentArgs
): Promise<{ attachment: LeaseClientAttachment; deduped: boolean }> {
  const { leaseClientId, buffer, url, filename, mime, category, certidaoJobId } = args;
  const contentHash = computeContentHash(buffer);

  const existing = await prisma.leaseClientAttachment.findFirst({
    where: { leaseClientId, contentHash },
  });
  if (existing) {
    return { attachment: existing, deduped: true };
  }

  const attachment = await prisma.leaseClientAttachment.create({
    data: {
      leaseClientId,
      filename,
      mime,
      url,
      category: category ?? null,
      byteSize: buffer.byteLength,
      contentHash,
      certidaoJobId: certidaoJobId ?? null,
    },
  });

  return { attachment, deduped: false };
}
