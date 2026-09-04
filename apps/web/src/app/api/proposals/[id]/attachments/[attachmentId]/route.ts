import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { archiveAttachment } from "@/lib/attachments/archive";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import {
  esteiraForProposalKind,
  parseProposalAssignment,
} from "@/lib/proposals/attachment-assignment";
import { shouldFlipGarantiaToFiador } from "@/lib/forms/garantia-fiador-flip";

export const runtime = "nodejs";

const patchSchema = z.object({
  assignment: z.object({ kind: z.string().min(1).max(40), index: z.number().int().min(0).max(50) }),
});

/**
 * PATCH /api/proposals/:id/attachments/:attachmentId — "Mover para…": grava o
 * assignment HUMANO em `extractedData.assignment` (+ `assignmentPersisted`).
 *
 * Locação: mover para o fiador/cônjuge do fiador DEFINE a garantia por fiança
 * — mas a proposta enviada é imutável (snapshot assinado), então aqui só
 * devolvemos `garantiaFlipped` para a UI avisar; o flip real acontece no
 * convert (`applyProposalExtractions` → `applyFiadorFlip`).
 */
export async function PATCH(
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

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad Request", details: parsed.error.flatten() }, { status: 400 });
  }
  const esteira = esteiraForProposalKind(proposal.kind);
  const assignment = parseProposalAssignment(parsed.data.assignment, esteira);
  if (!assignment) {
    return NextResponse.json({ error: "Atribuição inválida para esta proposta" }, { status: 400 });
  }

  const attachment = await prisma.proposalAttachment.findUnique({ where: { id: params.attachmentId } });
  if (!attachment || attachment.proposalId !== proposal.id) {
    return NextResponse.json({ error: "Anexo não encontrado nesta proposta" }, { status: 404 });
  }

  const current = (attachment.extractedData as Record<string, unknown> | null) ?? {};
  await prisma.proposalAttachment.update({
    where: { id: attachment.id },
    data: {
      extractedData: { ...current, assignment, assignmentPersisted: true } as unknown as Prisma.InputJsonValue,
    },
  });

  const garantia = ((proposal.dataJson as Record<string, unknown> | null)?.garantia ?? {}) as {
    tipo?: string;
  };
  const garantiaFlipped =
    esteira === "locacao" && shouldFlipGarantiaToFiador(assignment.kind, garantia.tipo);

  await audit(
    extractAuditContextFromRequest(req, authCtx.org.id, authCtx.actor.effectiveUserId),
    {
      action: "ATTACHMENT_RECLASSIFY",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "ProposalAttachment",
      metadata: { proposalId: proposal.id, assignment, garantiaFlipped },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, assignment, garantiaFlipped });
}

/**
 * DELETE /api/proposals/:id/attachments/:attachmentId
 *
 * Remove um documento da proposta. NÃO é exclusão definitiva: a linha vai pra
 * `DeletedAttachment` (arquivo permanente) na MESMA transação e o blob no
 * storage é preservado — dá pra restaurar depois. Mesmo caminho e mesma
 * política do anexo de negócio (`lib/attachments/archive.ts`).
 *
 * Existe porque a proposta ganhou upload sem ganhar remoção: dava pra anexar e
 * não dava pra tirar, e um arquivo subido por engano ficava na proposta pra
 * sempre.
 *
 * O blob NUNCA é apagado aqui, e isso é essencial e não só conservador:
 * `convert.ts` copia o ProposalAttachment pro DealAttachment REUSANDO a mesma
 * url ("mesmo blob, sem re-upload"). Apagar o objeto ao excluir o anexo da
 * proposta quebraria o documento do negócio já convertido. `DeletedAttachment
 * .url` e `ProposalAttachment.url` estão em `BLOB_REF_CHECKS`, então nada
 * trata o objeto como órfão.
 *
 * Permissão: PROPOSAL_SEND — a mesma de anexar. Pôr e tirar andam juntos, como
 * no par do negócio (DEAL_EDIT nos dois lados).
 */
export async function DELETE(
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
  if (!attachment) {
    return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
  }
  if (attachment.proposalId !== proposal.id) {
    return NextResponse.json(
      { error: "Anexo não pertence a esta proposta" },
      { status: 400 }
    );
  }

  // O "documento final" da proposta (dossiê do envelope OU comprovante do
  // Aceite) é o que `convert.ts` exige pra converter em negócio, e é a peça
  // probatória do que foi assinado/aceito. Excluí-lo pela lista de documentos
  // seria remover a prova por um clique de limpeza — bloqueia com 409 e
  // explica. Cancelar a proposta continua sendo o caminho pra desfazer.
  if (proposal.dossierUrl && attachment.url === proposal.dossierUrl) {
    return NextResponse.json(
      {
        error:
          "Este é o documento final da proposta (o que comprova a assinatura ou o aceite) e não pode ser excluído.",
      },
      { status: 409 }
    );
  }

  const archivedId = await prisma.$transaction((tx) =>
    archiveAttachment(tx, {
      row: attachment,
      origin: "proposal",
      via: "ui_proposal",
      orgId: authCtx.org.id,
      userId: authCtx.actor.effectiveUserId,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
    })
  );

  await audit(
    extractAuditContextFromRequest(req, authCtx.org.id, authCtx.actor.effectiveUserId),
    {
      action: "ATTACHMENT_DELETE",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "ProposalAttachment",
      metadata: {
        proposalId: proposal.id,
        filename: attachment.filename,
        category: attachment.category,
        source: attachment.source,
        archivedId,
        recoverable: true,
      },
    }
  );

  return NextResponse.json({ deleted: true, archivedId, recoverable: true });
}
