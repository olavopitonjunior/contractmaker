import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const patchSchema = z.object({
  htmlContent: z.string().min(1).max(5_000_000),
});

/**
 * PATCH /api/contracts/:id
 *
 * Auto-save endpoint for the contract editor. Persists the current HTML
 * content in-place, WITHOUT creating a new ContractVersion row. To create a
 * new version use POST /api/contracts/:id/version instead.
 *
 * Blocked when the contract is approved (status === 'aprovado').
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: { include: { form: { select: { orgId: true } } } },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    contract.deal?.form &&
    contract.deal.form.orgId !== org.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado nao pode ser editado" },
      { status: 403 }
    );
  }

  await prisma.contract.update({
    where: { id: params.id },
    data: {
      htmlContent: parsed.data.htmlContent,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/contracts/:id
 *
 * Apaga uma versão específica de contrato (Contract row). Cascata derruba
 * ContractClause/Comment/Suggestion/ChangeLog/ChatSession/Envelope via
 * onDelete:Cascade no schema. Best-effort: move o GDoc para a lixeira do
 * Drive antes do delete em DB.
 *
 * Bloqueio: status="aprovado" ou Envelope ClickSign closed/running → 409.
 * Se a versão deletada era isLatest, promove a próxima maior versão a latest.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: {
        select: {
          id: true,
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (contract.deal.pipeline.orgId !== org.id) {
    return NextResponse.json(
      { error: "Forbidden", reason: "contrato de outra organização" },
      { status: 403 }
    );
  }
  if (contract.status === "aprovado") {
    return NextResponse.json(
      {
        error:
          "Não é possível excluir contrato aprovado. Cancele a aprovação ou crie nova versão a partir do deal.",
      },
      { status: 409 }
    );
  }

  // Bloqueio: envelope ClickSign ativo
  const blockingEnvelope = await prisma.envelope.findFirst({
    where: {
      contractId: contract.id,
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

  // Best-effort: lixeira do Drive
  if (contract.googleDocId) {
    try {
      const { getOwnerDriveClient, isOwnerOAuthConfigured } = await import(
        "@/lib/google/client"
      );
      if (isOwnerOAuthConfigured()) {
        const drive = getOwnerDriveClient();
        await drive.files.update({
          fileId: contract.googleDocId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
      }
    } catch (err) {
      console.warn(
        `[contract DELETE] trash falhou para ${contract.googleDocId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Delete + promote latest em transação atômica
  let promoted: { contractId: string; version: number } | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.contract.delete({ where: { id: contract.id } });
    if (contract.isLatest) {
      const next = await tx.contract.findFirst({
        where: { dealId: contract.dealId },
        orderBy: { version: "desc" },
        select: { id: true, version: true },
      });
      if (next) {
        await tx.contract.update({
          where: { id: next.id },
          data: { isLatest: true },
        });
        promoted = { contractId: next.id, version: next.version };
      }
    }
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "CONTRACT_DELETE",
    result: "SUCCESS",
    resource: contract.id,
    resourceType: "Contract",
    metadata: {
      version: contract.version,
      wasLatest: contract.isLatest,
      promoted,
      googleDocTrashed: Boolean(contract.googleDocId),
    },
  });

  return NextResponse.json({ deleted: true, promoted });
}
