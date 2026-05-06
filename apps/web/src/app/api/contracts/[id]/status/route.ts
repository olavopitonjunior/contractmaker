import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

export const runtime = "nodejs";

const ALLOWED_STATUS = ["rascunho", "review"] as const;

const patchSchema = z.object({
  status: z.enum(ALLOWED_STATUS),
});

/**
 * PATCH /api/contracts/:id/status
 *
 * Move contrato entre estados reversíveis (rascunho ↔ review). Para
 * "aprovado" use o endpoint dedicado /api/contracts/:id/approve (HITL).
 * Bloqueia transições a partir de "aprovado".
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: {
        select: {
          form: { select: { orgId: true } },
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const contractOrgId =
    contract.deal?.form?.orgId ?? contract.deal?.pipeline?.orgId;
  if (contractOrgId !== apiAuth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado não pode ter status alterado por aqui. Crie nova versão." },
      { status: 409 }
    );
  }

  const previousStatus = contract.status;
  const updated = await prisma.contract.update({
    where: { id: params.id },
    data: { status: parsed.data.status },
    select: { id: true, status: true, updatedAt: true },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "CONTRACT_STATUS_UPDATE",
      result: "SUCCESS",
      resource: contract.id,
      resourceType: "Contract",
      metadata: mergeAuditMetadata(
        { from: previousStatus, to: updated.status },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json(updated);
}
