import { createHash } from "crypto";
import type { Prisma, ProposalAttachment } from "@prisma/client";
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
  /** "manual" | "public" | "clicksign_acceptance" | "clicksign_signed" | "dossier" | "infosimples" | "fichacerta" */
  source: string;
  /**
   * Documentos por parte (2026-09): `{ assignment, assignmentPersisted, fields?,
   * category?, confidence? }` — mesmo contrato do DealAttachment.
   */
  extractedData?: Record<string, unknown> | null;
  /** awaiting_user (default) | queued | extracting | ready | failed */
  status?: string;
  /** Job de certidão/laudo que originou o PDF. */
  certidaoJobId?: string | null;
  /** Ausente nos caminhos de sistema (webhook/script), onde não há sessão. */
  auditCtx?: AuditContext;
  auditMetadata?: Record<string, unknown>;
}

function readAssignmentOf(extractedData: unknown): { kind: string; index: number } | null {
  const e = extractedData && typeof extractedData === "object" ? (extractedData as Record<string, unknown>) : null;
  const a = e?.assignment && typeof e.assignment === "object" ? (e.assignment as Record<string, unknown>) : null;
  if (!a || typeof a.kind !== "string") return null;
  return { kind: a.kind, index: typeof a.index === "number" ? a.index : 0 };
}

/**
 * Registra o ProposalAttachment (idempotente por conteúdo). Se já existir anexo
 * com o mesmo `contentHash` na proposta, devolve o existente com `deduped: true`.
 *
 * Dedup NÃO descarta a escolha humana da parte: se o caller veio com
 * `extractedData.assignment` + `assignmentPersisted: true` e ela difere da que
 * o anexo existente tem (ou o existente só tinha sugestão do OCR), a atribuição
 * é aplicada ao existente — o mesmo efeito do "Mover para…". Sem isso, subir de
 * novo o mesmo comprovante escolhendo outra parte respondia "ok" e mantinha a
 * parte antiga em silêncio.
 *
 * Só entre anexos da MESMA origem (`source`): o lead, pela página pública,
 * não pode mover um documento que a imobiliária subiu (byte-idêntico ao que
 * ele mandou) — seria uma rota anônima reescrevendo a parte de um anexo
 * interno, e o convert leva os campos de OCR para onde o assignment aponta.
 */
export async function persistProposalDocument(
  args: PersistProposalDocumentArgs
): Promise<{ attachment: ProposalAttachment; deduped: boolean; assignmentUpdated: boolean }> {
  const { proposalId, buffer, url, filename, mime, category, source } = args;
  const contentHash = computeContentHash(buffer);

  const existing = await findProposalAttachmentByHash(proposalId, contentHash);
  if (existing) {
    const wanted = readAssignmentOf(args.extractedData);
    const wantedPersisted = args.extractedData?.assignmentPersisted === true;
    const has = readAssignmentOf(existing.extractedData);
    const hasPersisted =
      !!existing.extractedData &&
      typeof existing.extractedData === "object" &&
      (existing.extractedData as Record<string, unknown>).assignmentPersisted === true;
    const differs = !has || has.kind !== wanted?.kind || has.index !== wanted?.index || !hasPersisted;
    const sameSource = existing.source === source;
    const moveAssignment = !!(wanted && wantedPersisted && sameSource && differs);
    // Certidão retentada com PDF byte-idêntico ao da tentativa anterior: a
    // linha dedupada tem de passar a apontar para o job NOVO, senão a lista
    // (que casa PDF↔job por `certidaoJobId`) mostra o job vivo "sem anexo".
    const relinkJob = !!(args.certidaoJobId && existing.certidaoJobId !== args.certidaoJobId);
    if (moveAssignment || relinkJob) {
      const merged = {
        ...((existing.extractedData as Record<string, unknown> | null) ?? {}),
        ...(moveAssignment ? { assignment: wanted, assignmentPersisted: true } : {}),
      };
      const updated = await prisma.proposalAttachment.update({
        where: { id: existing.id },
        data: {
          ...(moveAssignment ? { extractedData: merged as unknown as Prisma.InputJsonValue } : {}),
          ...(relinkJob ? { certidaoJobId: args.certidaoJobId } : {}),
        },
      });
      return { attachment: updated, deduped: true, assignmentUpdated: moveAssignment };
    }
    return { attachment: existing, deduped: true, assignmentUpdated: false };
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
      ...(args.extractedData !== undefined
        ? { extractedData: (args.extractedData ?? undefined) as Prisma.InputJsonValue | undefined }
        : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.certidaoJobId ? { certidaoJobId: args.certidaoJobId } : {}),
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

  return { attachment, deduped: false, assignmentUpdated: false };
}
