import { createHash } from "crypto";
import { waitUntil } from "@vercel/functions";
import type { DealAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit, type AuditContext } from "@/lib/security/audit";

/**
 * Lógica compartilhada de registro de um documento na pasta do deal
 * (DealAttachment). Usada por dois caminhos de upload:
 *   - `attachments-newton` (Bearer/sessão, bytes via base64 JSON — Newton);
 *   - `attachments/finalize` (upload client-direct pro Blob — UI da pasta).
 *
 * Centraliza: dedupe por conteúdo (SHA-256), create, audit ATTACHMENT_UPLOAD e o
 * disparo fire-and-forget da análise de certidão. Mantém os dois caminhos em
 * paridade exata.
 */

export function computeContentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Anexo já existente no deal com o mesmo conteúdo (pra dedupe pré-upload). */
export function findDealAttachmentByHash(
  dealId: string,
  contentHash: string
): Promise<DealAttachment | null> {
  return prisma.dealAttachment.findFirst({ where: { dealId, contentHash } });
}

export interface PersistDealDocumentArgs {
  dealId: string;
  /** Buffer do arquivo — usado pra contentHash/byteSize (não re-sobe ao storage). */
  buffer: Buffer;
  /** URL já no storage (Blob/S3) — o upload é feito pelo caller. */
  url: string;
  filename: string;
  mime: string;
  category?: string | null;
  /** "manual" (UI) | "newton" | etc. */
  source: string;
  auditCtx: AuditContext;
  /** Metadata extra do audit (ex.: actor do Newton já mergeado pelo caller). */
  auditMetadata?: Record<string, unknown>;
}

/**
 * Registra o DealAttachment (idempotente por conteúdo). Se já existir anexo com
 * o mesmo `contentHash` no deal, devolve o existente com `deduped: true` (não
 * cria linha nova). Caso contrário cria, audita e dispara o OCR de certidão.
 */
export async function persistDealDocument(
  args: PersistDealDocumentArgs
): Promise<{ attachment: DealAttachment; deduped: boolean }> {
  const { dealId, buffer, url, filename, mime, category, source, auditCtx } = args;
  const contentHash = computeContentHash(buffer);

  const existing = await findDealAttachmentByHash(dealId, contentHash);
  if (existing) {
    return { attachment: existing, deduped: true };
  }

  const attachment = await prisma.dealAttachment.create({
    data: {
      dealId,
      filename,
      mime,
      url,
      category: category ?? null,
      source,
      byteSize: buffer.byteLength,
      contentHash,
    },
  });

  await audit(auditCtx, {
    action: "ATTACHMENT_UPLOAD",
    result: "SUCCESS",
    resource: attachment.id,
    resourceType: "DealAttachment",
    metadata: {
      ...(args.auditMetadata ?? {}),
      dealId,
      mime,
      bytes: buffer.byteLength,
      contentHash,
      source,
    },
  });

  // Quando a category é certidão ou matrícula anexada, dispara análise
  // fire-and-forget (OCR estruturado → crossCheckCertidoes → ContractComment).
  // Não bloqueia a resposta. `waitUntil` (não `void`) evita que a Vercel cancele
  // o fire-and-forget após o response retornar (#76 Fase 3+4).
  if (
    attachment.category &&
    (attachment.category.startsWith("certidao_") ||
      attachment.category === "matricula_anexada")
  ) {
    waitUntil(
      import("@/lib/services/manual-certidao-analysis").then(
        ({ analyzeManualCertidaoForDeal }) =>
          analyzeManualCertidaoForDeal(dealId, attachment.id).catch((err) => {
            console.error("[deal-attachments] analyzeManualCertidaoForDeal falhou:", err);
          })
      )
    );
  }

  return { attachment, deduped: false };
}
