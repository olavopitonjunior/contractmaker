import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

export const runtime = "nodejs";

/** GET /api/leads — list open leads pra org. */
export async function GET(req: NextRequest) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);

  const leads = await prisma.lead.findMany({
    where: { orgId: apiAuth.org.id, status },
    orderBy: { lastActivityAt: "desc" },
    take: limit,
    include: {
      attachments: { select: { id: true, filename: true, category: true } },
    },
  });

  return NextResponse.json({ leads });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  phones: z.array(z.string().regex(/^\+\d{10,15}$/)).optional(),
  notes: z.string().max(10000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** POST /api/leads — cria lead novo (briefing parsing externo, Newton-side). */
export async function POST(req: NextRequest) {
  const apiAuth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const lead = await prisma.lead.create({
    data: {
      orgId: apiAuth.org.id,
      userId: apiAuth.actor.effectiveUserId,
      title: parsed.data.title,
      phones: parsed.data.phones ?? [],
      notes: parsed.data.notes ?? "",
      metadata: (parsed.data.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });

  await audit(
    extractAuditContextFromRequest(req, apiAuth.org.id, apiAuth.actor.effectiveUserId),
    {
      action: "LEAD_CREATE",
      result: "SUCCESS",
      resource: lead.id,
      resourceType: "Lead",
      metadata: mergeAuditMetadata(
        { title: lead.title, phoneCount: lead.phones.length },
        apiAuth.actor
      ),
    }
  );

  return NextResponse.json({ lead }, { status: 201 });
}
