import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PermissionValue = (typeof PERMISSION)[keyof typeof PERMISSION];

// { [recordId]: { [fieldKey]: valorString } }
const StateSchema = z.record(z.record(z.string().max(200))).default({});

function parseYear(sp: URLSearchParams): number | null {
  const y = Number(sp.get("year"));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  return y;
}

async function auth(req: NextRequest, permission: PermissionValue) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return { error: authResult.response } as const;
  const { ctx } = authResult;
  try {
    await requirePermission({ userId: ctx.userId, orgId: ctx.orgId, permission });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return { error: NextResponse.json({ error: err.code }, { status: err.status }) } as const;
    }
    throw err;
  }
  return { ctx } as const;
}

/** GET — devolve o estado de overrides do ano. */
export async function GET(req: NextRequest) {
  const a = await auth(req, PERMISSION.REPORT_VIEW);
  if ("error" in a) return a.error;
  const year = parseYear(new URL(req.url).searchParams);
  if (year === null) return NextResponse.json({ error: "Ano inválido" }, { status: 400 });

  const row = await prisma.dimobOverride.findUnique({
    where: { orgId_year: { orgId: a.ctx.orgId, year } },
  });
  return NextResponse.json({ year, state: row?.state ?? {} });
}

/** PUT — grava (upsert) o estado de overrides do ano. */
export async function PUT(req: NextRequest) {
  const a = await auth(req, PERMISSION.REPORT_EXPORT);
  if ("error" in a) return a.error;
  const year = parseYear(new URL(req.url).searchParams);
  if (year === null) return NextResponse.json({ error: "Ano inválido" }, { status: 400 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = z.object({ state: StateSchema }).safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const row = await prisma.dimobOverride.upsert({
    where: { orgId_year: { orgId: a.ctx.orgId, year } },
    create: { orgId: a.ctx.orgId, year, state: parsed.data.state },
    update: { state: parsed.data.state },
  });
  return NextResponse.json({ year, state: row.state });
}

/** DELETE — limpa os overrides do ano. */
export async function DELETE(req: NextRequest) {
  const a = await auth(req, PERMISSION.REPORT_EXPORT);
  if ("error" in a) return a.error;
  const year = parseYear(new URL(req.url).searchParams);
  if (year === null) return NextResponse.json({ error: "Ano inválido" }, { status: 400 });

  await prisma.dimobOverride.deleteMany({ where: { orgId: a.ctx.orgId, year } });
  return NextResponse.json({ year, state: {} });
}
