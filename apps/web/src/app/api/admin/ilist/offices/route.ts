import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { createIListClient, IListError } from "@/lib/ilist/client";
import { isIListEnvConfigured } from "@/lib/ilist/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?regionId=71 — lista offices da região AO VIVO na RexAPI, pro formulário
 * de provisioning do super-admin escolher os offices do tenant.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await requirePlatformRole(session.user.id, "super_admin");
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  if (!isIListEnvConfigured()) {
    return NextResponse.json(
      { error: "ILIST_ENV_MISSING", message: "ILIST_BASE_URL/API_KEY/SECRET_KEY não configurados" },
      { status: 503 },
    );
  }

  const regionId = Number(req.nextUrl.searchParams.get("regionId"));
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return NextResponse.json({ error: "regionId inválido" }, { status: 400 });
  }

  try {
    const client = createIListClient(regionId);
    const offices: Array<{ id: number; name: string }> = [];
    let page = 1;
    for (;;) {
      const res = await client.offices.list({ page, take: 100 });
      for (const o of res.Items) {
        if (o.Terminated) continue;
        offices.push({ id: o.ID, name: o.OfficeName ?? `Office ${o.ID}` });
      }
      if (!res.HasNextPage) break;
      page++;
    }
    offices.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ regionId, offices });
  } catch (err) {
    if (err instanceof IListError) {
      return NextResponse.json(
        { error: "ILIST_API_ERROR", status: err.status, message: err.message },
        { status: 502 },
      );
    }
    throw err;
  }
}
