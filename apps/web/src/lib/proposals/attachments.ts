import { createHash } from "crypto";
import type { ProposalAttachment } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit, type AuditContext } from "@/lib/security/audit";

/**
 * Registro de um documento na proposta (ProposalAttachment) — o análogo de
 * `lib/deals/attachments.ts::persistDealDocument`, sem o ramo de OCR (que só faz
 * sentido pra certidão/matrícula na pasta do deal).
 *
 * Existia um vão aqui: `ProposalAttachment` só era criado por caminhos
 * automáticos (PDF assinado em `clicksign/signed-pdf.ts`, dossiê em `dossier.ts`,
 * comprovante em `acceptance-proof.ts`). Não havia nenhuma rota de upload pra
 * proposta — e é exatamente disso que se precisa pro Registro do Aceite, que a
 * ClickSign só entrega pela interface web.
 *
 * Dedupe por SHA-256 do conteúdo, o mesmo critério já usado nos caminhos
 * automáticos (que deduplicam por `url` OU `contentHash` por causa da corrida
 * webhook×cron). Aqui a `url` é sempre nova, então o hash é o que vale.
 */

export function computeContentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Anexo já existente na proposta com o mesmo conteúdo. */
export function findProposalAttachmentByHash(
  proposalId: string,
  contentHash: string
): Promise<ProposalAttachment | null> {
  return prisma.proposalAttachment.findFirst({
    where: { proposalId, contentHash },
  });
}

export interface PersistProposalDocumentArgs {
  proposalId: string;
  /** Buffer do arquivo — usado pra contentHash/byteSize (não re-sobe ao storage). */
  buffer: Buffer;
  /** URL já no storage (Blob/S3) — o upload é feito pelo caller. */
  url: string;
  filename: string;
  mime: string;
  category?: string | null;
  /** "manual" | "clicksign_acceptance" | "clicksign_signed" | "dossier" */
  source: string;
  /** Ausente nos caminhos de sistema (webhook/script), onde não há sessão. */
  auditCtx?: AuditContext;
  auditMetadata?: Record<string, unknown>;
}

/**
 * Registra o ProposalAttachment (idempotente por conteúdo). Se já existir anexo
 * com o mesmo `contentHash` na proposta, devolve o existente com `deduped: true`.
 */
export async function persistProposalDocument(
  args: PersistProposalDocumentArgs
): Promise<{ attachment: ProposalAttachment; deduped: boolean }> {
  const { proposalId, buffer, url, filename, mime, category, source } = args;
  const contentHash = computeContentHash(buffer);

  const existing = await findProposalAttachmentByHash(proposalId, contentHash);
  if (existing) {
    return { attachment: existing, deduped: true };
  }

  const attachment = await prisma.proposalAttachment.create({
    data: {
      proposalId,
      filename,
      mime,
      url,
      category: category ?? null,
      source,
      byteSize: buffer.byteLength,
      contentHash,
    },
  });

  if (args.auditCtx) {
    await audit(args.auditCtx, {
      action: "ATTACHMENT_UPLOAD",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "ProposalAttachment",
      metadata: {
        ...(args.auditMetadata ?? {}),
        proposalId,
        mime,
        bytes: buffer.byteLength,
        contentHash,
        source,
      },
    });
  }

  return { attachment, deduped: false };
}
