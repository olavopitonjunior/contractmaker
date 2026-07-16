import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  contractBelongsToOrg,
  orgScopedNotFound,
  resolveUserOrgId,
} from "@/lib/security/org-scope";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await resolveUserOrgId(session.user.id);
  if (!(await contractBelongsToOrg(params.id, orgId))) {
    return orgScopedNotFound("Contrato");
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";

  const suggestions = await prisma.contractSuggestion.findMany({
    where: {
      contractId: params.id,
      ...(status === "all" ? {} : { status }),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(suggestions);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.type) {
    return NextResponse.json({ error: "type é obrigatório" }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      status: true,
      deal: { select: { pipeline: { select: { orgId: true } } } },
    },
  });
  const orgId = await resolveUserOrgId(session.user.id);
  if (!contract || !orgId || contract.deal.pipeline.orgId !== orgId) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (contract.status === "aprovado") {
    return NextResponse.json({ error: "Contrato aprovado é imutável" }, { status: 403 });
  }

  const suggestion = await prisma.contractSuggestion.create({
    data: {
      contractId: params.id,
      userId: session.user.id,
      authorType: body.authorType || "user",
      type: body.type,
      suggestionId: randomUUID(),
      originalText: body.originalText ?? null,
      newText: body.newText ?? null,
      reason: body.reason ?? null,
    },
  });

  return NextResponse.json(suggestion, { status: 201 });
}
