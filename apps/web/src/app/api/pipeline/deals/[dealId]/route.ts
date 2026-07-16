import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
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
      stage: true,
      form: true,
      attachments: { orderBy: { createdAt: "desc" } },
      contracts: {
        where: { isLatest: true, kind: "contract" },
        include: { template: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      pipeline: { select: { orgId: true } },
    },
  });

  // Cross-org guard — o GET devolve o dossiê completo (dataJson com CPF/RG/
  // renda + anexos). Antes só exigia auth(); qualquer conta lia deal alheio.
  // 404 pra não vazar existência.
  if (!deal || (deal.form?.orgId ?? deal.pipeline.orgId) !== org.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  return NextResponse.json(deal);
}

const updateDealSchema = z.object({
  stageId: z.string().optional(),
  position: z.number().optional(),
  title: z.string().optional(),
  value: z.number().optional(),
  // Datas-marco manuais — preenchidas quando o card é arrastado pro stage e a
  // etapa NÃO foi feita no sistema (sem envelope/charge). ISO datetime.
  contractSignedAt: z.string().datetime().optional(),
  chargeIssuedAt: z.string().datetime().optional(),
  commissionPaidAt: z.string().datetime().optional(),
});

export async function PATCH(
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

  const body = await req.json();
  const parsed = updateDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Cross-org guard — esta rota grava datas-marco, então valida ownership.
  const existing = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: { select: { name: true } },
      form: { select: { orgId: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const dealOrgId = existing.form?.orgId ?? existing.pipeline.orgId;
  if (dealOrgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { contractSignedAt, chargeIssuedAt, commissionPaidAt, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (contractSignedAt) data.contractSignedAt = new Date(contractSignedAt);
  if (chargeIssuedAt) data.chargeIssuedAt = new Date(chargeIssuedAt);
  if (commissionPaidAt) data.commissionPaidAt = new Date(commissionPaidAt);
  // Aging por stage: drag pra outro stage carimba a entrada.
  if (parsed.data.stageId) data.stageEnteredAt = new Date();

  const deal = await prisma.deal.update({
    where: { id: params.dealId },
    data,
    include: { stage: true },
  });

  const milestoneDate = contractSignedAt || chargeIssuedAt || commissionPaidAt;
  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "DEAL_STAGE_CHANGE",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      kind: milestoneDate ? "manual_milestone_date" : "drag",
      fromStage: existing.stage.name,
      toStage: deal.stage.name,
      ...(contractSignedAt ? { contractSignedAt } : {}),
      ...(chargeIssuedAt ? { chargeIssuedAt } : {}),
      ...(commissionPaidAt ? { commissionPaidAt } : {}),
      ...(parsed.data.title !== undefined ? { changedTitle: true } : {}),
    },
  });

  return NextResponse.json(deal);
}

/**
 * Hard delete de Deal: remove em cascata CertidaoJobs, DealAttachments, Contracts
 * (que cascateia ContractClause/Comment/Suggestion/ChangeLog/ChatSession/Envelope
 * via onDelete: Cascade no schema), o próprio Deal e opcionalmente o SalesForm
 * de origem (?deleteForm=true).
 *
 * Bloqueio: deals com Envelope status="closed" (assinado pela ClickSign) não
 * podem ser deletados — preservar histórico legal. Status "running" também,
 * pra evitar interromper assinatura em andamento.
 *
 * Best-effort: tenta mover os Google Docs pra lixeira do Drive antes de remover
 * registros do DB. Falha de Drive não bloqueia delete.
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

  const url = new URL(req.url);
  const deleteForm = url.searchParams.get("deleteForm") === "true";

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      pipeline: { select: { orgId: true } },
      contracts: { select: { id: true, googleDocId: true } },
      attachments: { select: { id: true, url: true } },
      certidaoJobs: { select: { id: true } },
      envelopes: { select: { id: true, documentUrl: true, signedDocumentUrl: true } },
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

  // Bloqueio: envelope ClickSign assinado ou em curso
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
        error:
          "Não é possível excluir: existe envelope ClickSign em estado " +
          blockingEnvelope.status +
          ". Cancele a assinatura antes ou contate o admin.",
        envelopeId: blockingEnvelope.id,
        envelopeStatus: blockingEnvelope.status,
      },
      { status: 409 }
    );
  }

  // Best-effort: lixeira dos Google Docs
  const docsToTrash = deal.contracts
    .map((c) => c.googleDocId)
    .filter((id): id is string => Boolean(id));
  if (docsToTrash.length > 0) {
    try {
      const { trashDriveFile } = await import("@/lib/google/org-oauth");
      for (const docId of docsToTrash) {
        await trashDriveFile(docId, org.id);
      }
    } catch (err) {
      console.warn("[deal DELETE] não foi possível mover docs pra lixeira:", err);
    }
  }

  // Cleanup fora da cascata (ContractMemory sem FK + blobs órfãos). Coleta
  // ANTES do delete.
  const formId = deal.formId;
  const contractIds = deal.contracts.map((c) => c.id);
  const {
    collectContractBlobUrls,
    deleteContractMemories,
    deleteBlobs,
  } = await import("@/lib/contracts/delete-cleanup");
  const contractBlobUrls = await collectContractBlobUrls(prisma, contractIds);
  // Blobs de FormAttachment (RG/CNH) só somem se o form também for deletado.
  const formBlobUrls =
    deleteForm && formId
      ? (
          await prisma.formAttachment.findMany({
            where: { formId },
            select: { url: true },
          })
        ).map((a) => a.url)
      : [];

  // Cascata transacional. Onde Cascade FK não cobre (CertidaoJob, DealAttachment,
  // ContractMemory), fazemos deleteMany explícito.
  const counts = await prisma.$transaction(async (tx) => {
    const jobs = await tx.certidaoJob.deleteMany({ where: { dealId: deal.id } });
    const atts = await tx.dealAttachment.deleteMany({ where: { dealId: deal.id } });
    await deleteContractMemories(tx, contractIds);
    const contracts = await tx.contract.deleteMany({ where: { dealId: deal.id } });
    await tx.deal.delete({ where: { id: deal.id } });
    let formsDeleted = 0;
    if (deleteForm && formId) {
      const f = await tx.salesForm.delete({ where: { id: formId } }).catch(() => null);
      if (f) formsDeleted = 1;
    }
    return {
      certidaoJobs: jobs.count,
      attachments: atts.count,
      contracts: contracts.count,
      forms: formsDeleted,
    };
  });

  // Best-effort: apaga os blobs dos anexos e PDFs de envelope APÓS o commit
  // (se a transação falhar, não removemos arquivos). Antes a deleção do deal
  // órfãava 100% dos arquivos no Blob/S3. Cada item é isolado em try/catch
  // dentro de deleteFromStorage.
  // Dedup via Set — collectContractBlobUrls também traz os PDFs de envelope,
  // que já vêm de deal.envelopes; deletar a mesma URL 2× é inofensivo, mas o
  // Set evita trabalho redundante. Inclui ChatAttachment (via contratos) e
  // FormAttachment (RG/CNH) que antes ficavam órfãos.
  // FormAttachment (RG/CNH): só apaga os blobs se o form REALMENTE foi deletado.
  // O salesForm.delete acima é `.catch(()=>null)` — se ele falhar (FK/constraint),
  // o form e seus anexos sobrevivem; apagar os blobs mesmo assim deixaria o form
  // vivo apontando pra documentos de identidade que dão 404 (perda irrecuperável).
  const formBlobsToDelete = counts.forms > 0 ? formBlobUrls : [];
  const urlsToDelete = Array.from(
    new Set(
      [
        ...deal.attachments.map((a) => a.url),
        ...deal.envelopes.flatMap((e) => [e.documentUrl, e.signedDocumentUrl]),
        ...contractBlobUrls,
        ...formBlobsToDelete,
      ].filter((u): u is string => Boolean(u))
    )
  );
  // Pós-commit em waitUntil (como as rotas irmãs de contrato) — deletar dezenas
  // de PDFs sequencialmente inline poderia estourar o timeout e devolver 504
  // com as rows já commitadas.
  waitUntil(deleteBlobs(urlsToDelete));

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "DEAL_DELETE",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      ...counts,
      driveDocsTrashed: docsToTrash.length,
      blobsQueued: urlsToDelete.length,
      deleteForm,
    },
  });

  return NextResponse.json({ deleted: { deal: 1, ...counts } });
}
