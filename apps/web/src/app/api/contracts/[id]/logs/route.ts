import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  contractBelongsToOrg,
  orgScopedNotFound,
  resolveUserOrgId,
} from "@/lib/security/org-scope";
import { guardContractScope } from "@/lib/deals/route-helpers";

export async function GET(
  _req: NextRequest,
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

  // Escopo do gerente.
  const denied = await guardContractScope({
    contractId: params.id,
    userId: session.user.id,
    orgId: orgId!,
  });
  if (denied) return denied;

  const logs = await prisma.contractChangeLog.findMany({
    where: { contractId: params.id },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
    },
    take: 100,
  });

  return NextResponse.json(logs);
}
