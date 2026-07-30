import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getContractBudgetStatus } from "@/lib/ai/budget";
import {
  contractBelongsToOrg,
  orgScopedNotFound,
  resolveUserOrgId,
} from "@/lib/security/org-scope";
import { guardContractScope } from "@/lib/deals/route-helpers";

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
  // Escopo do gerente.
  const denied = await guardContractScope({
    contractId: params.id,
    userId: session.user.id,
    orgId: orgId!,
  });
  if (denied) return denied;

  const status = await getContractBudgetStatus(params.id);
  return NextResponse.json(status);
}
