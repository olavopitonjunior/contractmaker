import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import {
  contractBelongsToOrg,
  orgScopedNotFound,
  resolveUserOrgId,
} from "@/lib/security/org-scope";
import { markContractEditorPresence } from "@/lib/contracts/editor-presence";

export const runtime = "nodejs";

/**
 * POST /api/contracts/[id]/editing-ping
 *
 * Heartbeat leve do editor embedado: "este usuário está com o Google Doc deste
 * contrato aberto agora". Grava um marcador de presença em Redis (TTL curto) que
 * o webhook do Drive consome pra ATRIBUIR a edição manual — o push do Drive não
 * traz o autor (ver lib/contracts/editor-presence).
 *
 * Sessão-only e sem efeito de escrita no banco: é chamado a cada 5min por aba
 * aberta. Sem Redis configurado vira no-op silencioso (200).
 */
export async function POST(
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

  // Identidade efetiva (sob "trocar de tenant" o ator é o dono da org, que é quem
  // tem membership — mesma regra do resto das rotas escopadas).
  const userId = await getEffectiveUserId(session.user.id);
  await markContractEditorPresence(params.id, userId);

  return NextResponse.json({ ok: true });
}
