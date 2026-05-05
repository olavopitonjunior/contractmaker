import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { runContractApproval } from "@/lib/contracts/approve-action";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

const bodySchema = z.object({ force: z.boolean().optional().default(false) });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const force = parsed.data.force;

  // Cross-user check pra Bearer (precisa carregar antes do requireApproval pra
  // 403 não virar intent)
  if (apiAuth.ident.via === "bearer") {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { userId: true },
    });
    if (!contract) {
      return NextResponse.json(
        { error: "Contrato não encontrado" },
        { status: 404 }
      );
    }
    if (contract.userId !== apiAuth.ident.userId) {
      return NextResponse.json(
        { error: "Forbidden", reason: "not the contract owner" },
        { status: 403 }
      );
    }
  }

  // Resolve identidade do ator pra labels do ChangeLog
  const actorLabel =
    apiAuth.ident.via === "session"
      ? apiAuth.ident.email ?? apiAuth.ident.userId
      : `Newton (em nome de ${apiAuth.actor.effectiveUserId})`;

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await requireApproval<unknown>({
    ctx: apiAuth,
    action: "CONTRACT_APPROVE",
    payload: { contractId: params.id, force },
    preview: {
      summary: `Aprovar contrato ${params.id}${force ? " (forçado, ignora warnings)" : ""}`,
      details: { contractId: params.id, force },
    },
    req,
    idempotencyKey,
    run: async () => {
      const out = await runContractApproval({
        contractId: params.id,
        force,
        actorUserId: apiAuth.actor.effectiveUserId,
        actorLabel,
        enforceOwnerGuard: false, // já checamos acima
      });

      // Audit success path apenas (errors/requiresReview não auditam)
      if (out.status === 200 && "status" in out.body && out.body.status === "aprovado") {
        await audit(
          extractAuditContextFromRequest(
            req,
            apiAuth.org.id,
            apiAuth.actor.effectiveUserId
          ),
          {
            action: "CONTRACT_APPROVE",
            result: "SUCCESS",
            resource: params.id,
            resourceType: "Contract",
            metadata: mergeAuditMetadata({ forced: force }, apiAuth.actor),
          }
        );
      }

      return out;
    },
  });

  return approvalResponse(result);
}
