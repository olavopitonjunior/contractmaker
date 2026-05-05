import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * DELETE /api/pipeline/deals/:dealId/contracts
 *
 * Apaga TODAS as versões de contrato (Contract rows) deste deal de uma vez.
 * Mantém o Deal e o SalesForm de origem intactos — útil para limpar
 * rascunhos antigos sem perder o negócio.
 *
 * Bloqueio: se houver contrato com status="aprovado" ou Envelope ClickSign
 * em closed/running, retorna 409 sem apagar nada.
 *
 * Best-effort: tenta mover cada googleDocId para a lixeira do Drive antes
 * do delete em DB. Falhas individuais não bloqueiam — só registram log.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      pipeline: { select: { orgId: true } },
      contracts: {
        select: { id: true, status: true, googleDocId: true, version: true },
      },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json(
      { error: "Forbidden", reason: "deal de outra organização" },
      { status: 403 }
    );
  }

  if (deal.contracts.length === 0) {
    return NextResponse.json({ deleted: { contracts: 0, googleDocsTrashed: 0 } });
  }

  // Bloqueio: contrato aprovado
  const approved = deal.contracts.find((c) => c.status === "aprovado");
  if (approved) {
    return NextResponse.json(
      {
        error: `Não é possível excluir: contrato v${approved.version} está aprovado. Exclua o negócio inteiro ou cancele a aprovação primeiro.`,
        contractId: approved.id,
      },
      { status: 409 }
    );
  }

  // Bloqueio: envelope ClickSign ativo
  const blockingEnvelope = await prisma.envelope.findFirst({
    where: {
      dealId: deal.id,
      status: { in: ["closed", "running"] },
    },
    select: { id: true, status: true },
  });
  if (blockingEnvelope) {
    return NextResponse.json(
      {
        error: `Envelope ClickSign em estado ${blockingEnvelope.status}. Cancele antes de excluir.`,
        envelopeId: blockingEnvelope.id,
      },
      { status: 409 }
    );
  }

  // Best-effort: lixeira dos GDocs (sequencial com sleep pra não estourar rate)
  const docsToTrash = deal.contracts
    .map((c) => c.googleDocId)
    .filter((id): id is string => Boolean(id));
  let trashed = 0;
  if (docsToTrash.length > 0) {
    try {
      const { getOwnerDriveClient, isOwnerOAuthConfigured } = await import(
        "@/lib/google/client"
      );
      if (isOwnerOAuthConfigured()) {
        const drive = getOwnerDriveClient();
        for (const docId of docsToTrash) {
          try {
            await drive.files.update({
              fileId: docId,
              requestBody: { trashed: true },
              supportsAllDrives: true,
            });
            trashed++;
            await new Promise((r) => setTimeout(r, 200));
          } catch (err) {
            console.warn(
              `[deal contracts DELETE] trash falhou para ${docId}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }
    } catch (err) {
      console.warn("[deal contracts DELETE] não foi possível inicializar Drive:", err);
    }
  }

  // Cascata FK derruba ContractClause/Comment/Suggestion/ChangeLog/ChatSession/Envelope
  const result = await prisma.contract.deleteMany({ where: { dealId: deal.id } });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "CONTRACT_DELETE_BULK",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      contractsDeleted: result.count,
      googleDocsTrashed: trashed,
    },
  });

  return NextResponse.json({
    deleted: { contracts: result.count, googleDocsTrashed: trashed },
  });
}
