import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { appendEvent, serializeRequest } from "@/lib/newton/requests";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";

export const runtime = "nodejs";

/**
 * Pedidos ao Newton ancorados num Deal. A negociadora (que pode não estar em
 * nenhum grupo de WhatsApp) registra o que falta e para quem cobrar; Newton vai
 * até o grupo/contato, cobra, agenda lembretes e fecha quando a info chega.
 *
 * GET  /api/deals/:dealId/newton-requests        — lista (UI do negócio)
 * POST /api/deals/:dealId/newton-requests        — cria + dispara o Newton na hora
 */

const createSchema = z.object({
  ask: z.string().trim().min(3).max(2000),
  targetType: z.enum(["contact", "group"]),
  // contact: phone E.164 sem '+'. group: opcional (Newton resolve o JID depois).
  targetRef: z.string().trim().max(64).optional(),
  targetLabel: z.string().trim().max(120).optional(),
  priority: z.enum(["normal", "high"]).default("normal"),
  dueAt: z.string().datetime().optional(),
});

/** Resolve a org do deal e garante que pertence à org do caller. */
async function loadDealOrg(dealId: string, orgId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return { error: "Deal not found" as const, status: 404 as const };
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== orgId) return { error: "Forbidden" as const, status: 403 as const };
  return { dealOrgId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:r" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const guard = await loadDealOrg(params.dealId, auth.org.id);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const requests = await prisma.newtonRequest.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests: requests.map(serializeRequest) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ask, targetType, targetRef, targetLabel, priority, dueAt } = parsed.data;

  // contact exige um telefone; group pode vir sem JID (Newton resolve depois).
  if (targetType === "contact" && !targetRef) {
    return NextResponse.json(
      { error: "targetRef (telefone) obrigatório para targetType=contact" },
      { status: 400 }
    );
  }

  const guard = await loadDealOrg(params.dealId, auth.org.id);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const created = await prisma.newtonRequest.create({
    data: {
      orgId: guard.dealOrgId,
      dealId: params.dealId,
      createdBy: auth.actor.effectiveUserId,
      ask,
      targetType,
      targetRef: targetRef ?? null,
      targetLabel: targetLabel ?? null,
      priority,
      dueAt: dueAt ? new Date(dueAt) : null,
      status: "open",
      eventsJson: appendEvent(null, {
        actor: "negociadora",
        type: "created",
        note: ask,
      }),
    },
  });

  // Dispara o Newton na hora (fire-and-forget — não bloqueia a resposta).
  // waitUntil mantém o lambda vivo após o NextResponse; sem ele a Vercel
  // cancela a promise e o trigger pode não chegar ao sidecar.
  waitUntil(triggerNewtonForRequest({
    dealId: params.dealId,
    requestId: created.id,
    ask,
    targetType,
    targetRef: targetRef ?? null,
    targetLabel: targetLabel ?? null,
    kind: "create",
  }));

  return NextResponse.json(serializeRequest(created), { status: 201 });
}
