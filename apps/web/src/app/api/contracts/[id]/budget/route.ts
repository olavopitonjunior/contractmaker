import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getContractBudgetStatus } from "@/lib/ai/budget";
import {
  contractBelongsToOrg,
  orgScopedNotFound,
  resolveUserOrgId,
} from "@/lib/security/org-scope";

/**
 * Retorna { spent, budget, pct, remaining, ok } pra UI mostrar indicador
 * de consumo de IA do contrato. Sem cache — número precisa refletir o
 * estado pós-última chamada IA pra o usuário ver consumo em tempo real.
 */
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
  const status = await getContractBudgetStatus(params.id);
  return NextResponse.json(status);
}
