import { NextRequest, NextResponse } from "next/server";
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

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: true,
      form: true,
      attachments: { orderBy: { createdAt: "desc" } },
      contracts: {
        where: { isLatest: true },
        include: { template: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  return NextResponse.json(deal);
}

const updateDealSchema = z.object({
  stageId: z.string().optional(),
  position: z.number().optional(),
  title: z.string().optional(),
  value: z.number().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = updateDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const deal = await prisma.deal.update({
    where: { id: params.dealId },
    data: parsed.data,
    include: { stage: true },
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
      attachments: { select: { id: true } },
      certidaoJobs: { select: { id: true } },
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
      const { getOwnerDriveClient, isOwnerOAuthConfigured } = await import("@/lib/google/client");
      if (isOwnerOAuthConfigured()) {
        const drive = getOwnerDriveClient();
        for (const docId of docsToTrash) {
          try {
            await drive.files.update({
              fileId: docId,
              requestBody: { trashed: true },
              supportsAllDrives: true,
            });
          } catch (err) {
            console.warn(
              `[deal DELETE] trash falhou para doc ${docId}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }
    } catch (err) {
      console.warn("[deal DELETE] não foi possível mover docs pra lixeira:", err);
    }
  }

  // Cascata transacional. Onde Cascade FK não cobre (CertidaoJob, DealAttachment),
  // fazemos deleteMany explícito.
  const formId = deal.formId;
  const counts = await prisma.$transaction(async (tx) => {
    const jobs = await tx.certidaoJob.deleteMany({ where: { dealId: deal.id } });
    const atts = await tx.dealAttachment.deleteMany({ where: { dealId: deal.id } });
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

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "DEAL_DELETE",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      ...counts,
      driveDocsTrashed: docsToTrash.length,
      deleteForm,
    },
  });

  return NextResponse.json({ deleted: { deal: 1, ...counts } });
}
