import { NextRequest, NextResponse } from "next/server";
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
  const authorType = url.searchParams.get("authorType");
  const unresolvedOnly = url.searchParams.get("unresolved") === "true";

  const where: Record<string, unknown> = {
    contractId: params.id,
    parentId: null,
  };
  if (authorType) where.authorType = authorType;
  if (unresolvedOnly) where.resolved = false;

  const [total, errors, warnings, infos] = await Promise.all([
    prisma.contractComment.count({ where }),
    prisma.contractComment.count({ where: { ...where, severity: "error" } }),
    prisma.contractComment.count({ where: { ...where, severity: "warning" } }),
    prisma.contractComment.count({ where: { ...where, severity: "info" } }),
  ]);

  const maxSeverity: "error" | "warning" | "info" | null =
    errors > 0 ? "error" : warnings > 0 ? "warning" : infos > 0 ? "info" : null;

  return NextResponse.json({
    total,
    errors,
    warnings,
    infos,
    maxSeverity,
  });
}
