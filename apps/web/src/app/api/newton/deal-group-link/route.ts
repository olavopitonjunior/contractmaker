import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vínculo deal ↔ grupo de WhatsApp (um grupo = um deal). Newton (Bearer) grava
 * na 1ª vez que associa um grupo a um negócio, e consulta nos dois sentidos:
 *   - resolve_deal_group:  GET ?dealId=...  → qual grupo é deste deal
 *   - lookup_deal_by_group: GET ?groupId=... → qual deal é deste grupo
 *
 * POST grava/atualiza o vínculo (upsert por dealId).
 */
function serialize(l: {
  dealId: string;
  groupId: string;
  groupLabel: string | null;
  confirmedBy: string | null;
  updatedAt: Date;
}) {
  return {
    dealId: l.dealId,
    groupId: l.groupId,
    groupLabel: l.groupLabel,
    confirmedBy: l.confirmedBy,
    updatedAt: l.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:r" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const url = new URL(req.url);
  const dealId = url.searchParams.get("dealId");
  const groupId = url.searchParams.get("groupId");
  if (!dealId && !groupId) {
    return NextResponse.json(
      { error: "informe dealId ou groupId" },
      { status: 400 }
    );
  }

  if (dealId) {
    const link = await prisma.dealGroupLink.findUnique({ where: { dealId } });
    if (!link || link.orgId !== auth.org.id) {
      return NextResponse.json({ link: null });
    }
    return NextResponse.json({ link: serialize(link) });
  }

  // groupId → pode haver mais de um deal (grupos reusados); devolve lista.
  const links = await prisma.dealGroupLink.findMany({
    where: { orgId: auth.org.id, groupId: groupId! },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ links: links.map(serialize) });
}

const postSchema = z.object({
  dealId: z.string().min(1),
  groupId: z.string().trim().min(3).max(128),
  groupLabel: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { dealId, groupId, groupLabel } = parsed.data;

  // Garante que o deal pertence à org do token.
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true } },
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const dealOrgId = deal.form?.orgId ?? deal.pipeline.orgId;
  if (dealOrgId !== auth.org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const link = await prisma.dealGroupLink.upsert({
    where: { dealId },
    create: {
      orgId: dealOrgId,
      dealId,
      groupId,
      groupLabel: groupLabel ?? null,
      confirmedBy: auth.actor.effectiveUserId,
    },
    update: {
      groupId,
      groupLabel: groupLabel ?? null,
      confirmedBy: auth.actor.effectiveUserId,
    },
  });

  return NextResponse.json({ link: serialize(link) }, { status: 201 });
}
