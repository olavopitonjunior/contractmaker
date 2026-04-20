import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { timingSafeEqualStr } from "@/lib/security/crypto";
import { seedPagadoriaQa, cleanupPagadoriaQa } from "@/lib/dev/seedPagadoriaQa";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

function isAllowedEnv(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.VERCEL_ENV === "preview") return true;
  return false;
}

function checkToken(req: NextRequest): boolean {
  const expected = process.env.SEED_ADMIN_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqualStr(match[1], expected);
}

async function resolveUserAndOrg(body: {
  email?: string;
  orgId?: string;
}): Promise<{ userId: string; orgId: string } | { error: string; status: number }> {
  if (body.orgId) {
    const membership = await prisma.orgMembership.findFirst({
      where: { orgId: body.orgId, role: { in: ["owner", "admin"] } },
      orderBy: { invitedAt: "asc" },
    });
    if (!membership) return { error: "Nenhum owner/admin encontrado na org", status: 404 };
    return { userId: membership.userId, orgId: body.orgId };
  }
  const email = body.email ?? "admin@contractmaker.com";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { error: `Usuário ${email} não encontrado`, status: 404 };
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: user.id },
    orderBy: { invitedAt: "asc" },
  });
  if (!membership) return { error: `Usuário ${email} sem org`, status: 404 };
  return { userId: user.id, orgId: membership.orgId };
}

/**
 * POST /api/admin/seed-pagadoria-qa
 *
 * Popula dados fake para QA UX/UI do módulo Pagadoria.
 * Exige header `Authorization: Bearer $SEED_ADMIN_TOKEN` e ambiente não-prod
 * (NODE_ENV !== production OU VERCEL_ENV === preview).
 *
 * Body opcional: { "email"?: string, "orgId"?: string }
 *   Default: usa admin@contractmaker.com
 */
export async function POST(req: NextRequest) {
  if (!isAllowedEnv()) {
    return NextResponse.json(
      { error: "Endpoint bloqueado em produção" },
      { status: 403 }
    );
  }
  if (!checkToken(req)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const resolved = await resolveUserAndOrg(body);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  try {
    const result = await seedPagadoriaQa(resolved.orgId, resolved.userId);
    return NextResponse.json({
      ok: true,
      ...result,
      summary: {
        account: "APPROVED (fake — sandbox bypass)",
        customers: result.customerIds.length,
        charges: result.chargeIds.length,
        publicPayUrl: `/pay/${result.publicLinkToken}`,
        dualApproval: `/financeiro/dual-approvals/${result.dualApprovalId}`,
        reconciliations: result.reconciliationIds.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Seed falhou",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/seed-pagadoria-qa
 *
 * Remove todos os dados QA ([QA UX] prefix) e reverte AsaasAccount para AWAITING_DOCS.
 */
export async function DELETE(req: NextRequest) {
  if (!isAllowedEnv()) {
    return NextResponse.json(
      { error: "Endpoint bloqueado em produção" },
      { status: 403 }
    );
  }
  if (!checkToken(req)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const resolved = await resolveUserAndOrg(body);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const result = await cleanupPagadoriaQa(resolved.orgId);
  return NextResponse.json({ ok: true, ...result });
}
