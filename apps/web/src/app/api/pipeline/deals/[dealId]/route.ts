import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { archiveDealAttachmentsBeforeCascade } from "@/lib/attachments/archive";
import {
  notifyDealEvent,
  stageChangeDedupeKey,
} from "@/lib/notifications/deal-events";
import { z } from "zod";
import { queueSurveyDispatch } from "@/lib/surveys/dispatch";
import { getEffectivePermissions, canAccessDeal } from "@/lib/security/rbac/check";

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

  // Escopo por usuário (feature Gerente): visão restrita só acessa deals onde
  // é gerente atribuído ou criador. 404 pra não vazar existência.
  const eff = await getEffectivePermissions(session.user.id, org.id);
  if (
    !eff ||
    !canAccessDeal({
      effective: eff,
      ownerUserId: deal.userId,
      managerUserId: deal.managerUserId,
    })
  ) {
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

  // Escopo por usuário (feature Gerente).
  const eff = await getEffectivePermissions(session.user.id, org.id);
  if (
    !eff ||
    !canAccessDeal({
      effective: eff,
      ownerUserId: existing.userId,
      managerUserId: existing.managerUserId,
    })
  ) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
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

  // Notificação do processo: drag pra stage diferente. Perdido fica fora da
  // v1 (mark-lost tem endpoint próprio, sem hook de propósito). dedupeKey por
  // (stage, dia) — re-drag no mesmo dia não re-envia.
  if (parsed.data.stageId && parsed.data.stageId !== existing.stageId) {
    waitUntil(
      notifyDealEvent({
        dealId: deal.id,
        orgId: org.id,
        event: "stage_change",
        dedupeKey: stageChangeDedupeKey(deal.stageId),
        context: { stageName: deal.stage.name },
      })
    );
  }

  // Pesquisas: só quando o stage realmente mudou (o PATCH também salva título/datas).
  if (parsed.data.stageId && deal.stage.name !== existing.stage.name) {
    queueSurveyDispatch(deal.id, deal.stage.name);
  }

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

  // Escopo por usuário (feature Gerente) — delete é destrutivo; visão restrita
  // só alcança os próprios deals (e mesmo assim o botão é gated na UI).
  const eff = await getEffectivePermissions(session.user.id, org.id);
  if (
    !eff ||
    !canAccessDeal({
      effective: eff,
      ownerUserId: deal.userId,
      managerUserId: deal.managerUserId,
    })
  ) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
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

  // Cascata transacional do DEAL. O salesForm.delete fica FORA desta tx: um
  // `.catch(()=>null)` dentro dela era ilusório — no Postgres qualquer erro de
  // statement ABORTA a transação inteira, então o form falhando reverteria o
  // delete do deal/contratos/anexos SEM sinalizar, e mesmo assim os blobs eram
  // apagados depois (rows sobreviviam → 404 irrecuperável). Separado, o form é
  // best-effort de verdade e não arrasta o delete do deal.
  const auditIp = req.headers.get("x-forwarded-for") ?? null;
  const counts = await prisma.$transaction(async (tx) => {
    const jobs = await tx.certidaoJob.deleteMany({ where: { dealId: deal.id } });
    // Arquiva ANTES do deleteMany: apagar o negócio levava os documentos e o
    // audit de DEAL_DELETE guardava só a CONTAGEM, sem os ids nem os nomes —
    // não dava pra dizer depois o que exatamente se perdeu. Como as URLs
    // arquivadas entram em BLOB_REF_CHECKS, o `deleteBlobs` lá embaixo passa a
    // pular os blobs desses anexos sozinho.
    await archiveDealAttachmentsBeforeCascade(tx, {
      dealId: deal.id,
      orgId: org.id,
      userId: session.user.id,
      ipAddress: auditIp,
    });
    const atts = await tx.dealAttachment.deleteMany({ where: { dealId: deal.id } });
    await deleteContractMemories(tx, contractIds);
    const contracts = await tx.contract.deleteMany({ where: { dealId: deal.id } });
    await tx.deal.delete({ where: { id: deal.id } });
    return {
      certidaoJobs: jobs.count,
      attachments: atts.count,
      contracts: contracts.count,
      forms: 0,
    };
  });

  // Form em transação SEPARADA (após o deal já ter sido deletado com sucesso).
  if (deleteForm && formId) {
    const f = await prisma.salesForm
      .delete({ where: { id: formId } })
      .catch((err) => {
        console.warn("[deal DELETE] salesForm.delete falhou (form mantido):", err);
        return null;
      });
    if (f) counts.forms = 1;
  }

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
  waitUntil(deleteBlobs(urlsToDelete, prisma));

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
