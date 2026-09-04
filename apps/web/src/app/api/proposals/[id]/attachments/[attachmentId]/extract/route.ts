import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { classifyAndExtract, humanizeOcrError } from "@/lib/ai/ocr";
import { suggestAssignment } from "@/lib/forms/extracted-to-form";
import { suggestLocacaoAssignment } from "@/lib/forms/extracted-to-form-locacao";
import {
  esteiraForProposalKind,
  proposalPartiesSnapshot,
  readAttachmentExtracted,
} from "@/lib/proposals/attachment-assignment";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Claim mais velho que isto é considerado abandonado (função morta). */
const STALE_CLAIM_MS = 90_000;

function isOcrableMime(mime: string): boolean {
  return mime === "application/pdf" || mime.startsWith("image/");
}

/**
 * POST /api/proposals/:id/attachments/:attachmentId/extract
 *
 * OCR (Gemini) sob demanda num anexo da PROPOSTA — o mesmo contrato do
 * DealAttachment (`extractedData = { fields, confidence, category, assignment,
 * assignmentPersisted }`) para o convert copiar verbatim e a aba do negócio
 * reaproveitar os componentes.
 *
 * Diferença do deal: ProposalAttachment tem máquina de status
 * (awaiting_user → extracting → ready|failed) e o claim é ATÔMICO
 * (`updateMany` com `extractingStartedAt` nulo ou velho): dois cliques no
 * mesmo card não pagam dois OCRs. A sugestão de slot só entra quando não há
 * assignment humano persistido.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; attachmentId: string } }
) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth: authCtx, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(authCtx.org.id, proposal.kind);
  if (feat) return feat;

  const attachment = await prisma.proposalAttachment.findUnique({
    where: { id: params.attachmentId },
  });
  if (!attachment || attachment.proposalId !== proposal.id) {
    return NextResponse.json({ error: "Anexo não encontrado nesta proposta" }, { status: 404 });
  }
  if (!isOcrableMime(attachment.mime)) {
    return NextResponse.json(
      { error: `Tipo ${attachment.mime} não suporta leitura por IA (apenas PDF e imagens)` },
      { status: 415 }
    );
  }

  // Claim atômico.
  const now = new Date();
  const claimed = await prisma.proposalAttachment.updateMany({
    where: {
      id: attachment.id,
      OR: [
        { extractingStartedAt: null },
        { extractingStartedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
      ],
    },
    data: { status: "extracting", extractingStartedAt: now, extractError: null },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Extração já em andamento" }, { status: 409 });
  }

  // Toda escrita terminal é condicionada a AINDA sermos o dono do claim
  // (`extractingStartedAt === now` e status `extracting`). Uma função morta
  // pelo maxDuration que acorde depois de outro clique ter re-clamado (> 90 s)
  // não pode sobrescrever o resultado da corrida mais nova.
  const ownClaim = { id: attachment.id, extractingStartedAt: now, status: "extracting" } as const;

  const fail = async (message: string, status: number) => {
    await prisma.proposalAttachment
      .updateMany({
        where: ownClaim,
        data: { status: "failed", extractError: message.slice(0, 500), extractingStartedAt: null },
      })
      .catch(() => {});
    return NextResponse.json({ error: message }, { status });
  };

  let buffer: Buffer;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return fail(`Falha ao baixar anexo (${res.status})`, 502);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return fail(`Falha ao baixar anexo: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  let extraction;
  try {
    extraction = await classifyAndExtract(
      buffer.toString("base64"),
      attachment.mime,
      { orgId: authCtx.org.id, userId: authCtx.actor.effectiveUserId, contractId: null },
      { buffer }
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return fail(humanizeOcrError(raw), 502);
  }

  // Relê o anexo DEPOIS do OCR (segundos): um "Mover para…" que aconteceu
  // enquanto o Gemini rodava é a escolha humana mais recente e tem de vencer —
  // reaproveitar o snapshot de antes da chamada a reverteria em silêncio.
  const fresh = await prisma.proposalAttachment.findUnique({
    where: { id: attachment.id },
    select: { extractedData: true, category: true },
  });
  const latestExtracted = fresh ? fresh.extractedData : attachment.extractedData;
  const latestCategory = fresh ? fresh.category : attachment.category;

  const current = readAttachmentExtracted(latestExtracted);
  const esteira = esteiraForProposalKind(proposal.kind);
  const snap = proposalPartiesSnapshot(proposal.dataJson);
  const suggested =
    esteira === "locacao"
      ? suggestLocacaoAssignment(
          extraction.documentType,
          extraction.fields,
          { locadores: snap.locadores, locatarios: snap.locatarios, garantia: snap.garantia },
          []
        )
      : suggestAssignment(
          extraction.documentType,
          extraction.fields,
          { vendedores: snap.vendedores, compradores: snap.compradores, imoveis: snap.imoveis },
          []
        );
  // Escolha humana anterior vence a sugestão.
  const assignment = current.assignmentPersisted ? current.assignment : suggested;

  const extractedData = {
    ...((latestExtracted as Record<string, unknown> | null) ?? {}),
    fields: extraction.fields,
    confidence: extraction.confidence,
    category: extraction.documentType,
    assignment,
    assignmentPersisted: current.assignmentPersisted,
  };

  const written = await prisma.proposalAttachment.updateMany({
    where: ownClaim,
    data: {
      extractedData: extractedData as unknown as Prisma.InputJsonValue,
      status: "ready",
      extractError: null,
      extractingStartedAt: null,
      ...(latestCategory && latestCategory !== "documento"
        ? {}
        : { category: extraction.documentType }),
    },
  });
  if (written.count === 0) {
    // Perdemos o claim para uma corrida mais nova — ela grava o resultado dela.
    return NextResponse.json(
      { error: "Extração refeita por outra requisição; recarregue a página" },
      { status: 409 }
    );
  }

  await audit(
    extractAuditContextFromRequest(req, authCtx.org.id, authCtx.actor.effectiveUserId),
    {
      action: "ATTACHMENT_EXTRACT",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "ProposalAttachment",
      metadata: {
        proposalId: proposal.id,
        documentType: extraction.documentType,
        confidence: extraction.confidence,
      },
    }
  ).catch(() => {});

  return NextResponse.json({
    attachmentId: attachment.id,
    category: extraction.documentType,
    fields: extraction.fields,
    confidence: extraction.confidence,
    assignment,
    assignmentPersisted: current.assignmentPersisted,
  });
}
