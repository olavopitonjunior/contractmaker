import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requireOrgAdmin } from "@/lib/security/org-scope";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getOrgAiBudgetStatus } from "@/lib/ai/budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/PUT /api/settings/ai-budget — teto mensal de IA da org (USD).
 * GET: qualquer membro (o dashboard de uso mostra a barra).
 * PUT: owner/admin + audit (mesmo padrão do settings/agent).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const status = await getOrgAiBudgetStatus(org.id);
  return NextResponse.json(status);
}

const putSchema = z.object({
  // null = remover o teto. Cap alto de sanidade (US$ 100k/mês).
  budgetUsd: z.number().min(1).max(100_000).nullable(),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const gate = await requireOrgAdmin(session.user.id);
  if (!gate.ok) return gate.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // OrgFinancialSettings.orgId não é @unique (multi-account) — atualiza a row
  // existente da org ou cria uma sem accountId.
  const existing = await prisma.orgFinancialSettings.findFirst({
    where: { orgId: org.id },
    select: { id: true },
  });
  if (existing) {
    await prisma.orgFinancialSettings.update({
      where: { id: existing.id },
      data: { aiMonthlyBudgetUsd: parsed.data.budgetUsd },
    });
  } else {
    await prisma.orgFinancialSettings.create({
      data: { orgId: org.id, aiMonthlyBudgetUsd: parsed.data.budgetUsd },
    });
  }

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "AGENT_CONFIG_UPDATE",
    result: "SUCCESS",
    resourceType: "OrgFinancialSettings",
    resource: org.id,
    metadata: { field: "aiMonthlyBudgetUsd", value: parsed.data.budgetUsd },
  });

  return NextResponse.json({ ok: true });
}
