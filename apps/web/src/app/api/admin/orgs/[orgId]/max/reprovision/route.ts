import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { syncMaxForOrg } from "@/lib/max/provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orgs/[orgId]/max/reprovision
 *
 * Força a reemissão do acesso do Max a uma org, MESMO quando ela está saudável.
 *
 * **Por que precisa existir.** `POST /api/org/max/activate` passou a responder
 * `noop` quando a org já está `active` com entrega confirmada — e com razão:
 * `syncMaxForOrg` sempre rotaciona (`createApiToken` não é idempotente), e
 * rotacionar um tenant que funciona é trocar credencial sem motivo. Só que
 * aquela trava fechou o ÚNICO caminho de reemitir de propósito, e há dois casos
 * em que reemitir é exatamente o certo:
 *
 *  - **o token vazou** e precisa ser invalidado agora;
 *  - **os escopos mudaram** — o Max ganhar uma capacidade nova (escrita, na
 *    Fase 3) exige token novo, porque escopo é gravado na emissão.
 *
 * Sem esta rota, a saída seria desligar e religar a feature no painel de
 * módulos, o que passa pelo caminho de REVOGAÇÃO: uma janela com o tenant sem
 * credencial nenhuma, por causa de uma operação que deveria ser contínua.
 *
 * `super_admin`, e não o dono: rotação é operação de plataforma, e o dono não
 * tem como saber que um token vazou nem que o escopo mudou.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await requirePlatformRole(session.user.id, "super_admin");
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json(
        { error: err.code, requiredRole: err.requiredRole },
        { status: err.status }
      );
    }
    throw err;
  }

  const result = await syncMaxForOrg(params.orgId);

  // `delivered: false` é 200 aqui pelo mesmo motivo do endpoint do dono: o token
  // foi emitido e é válido, o que faltou foi a entrega — e o cron reconcilia.
  // Um erro faria o operador rodar de novo, e cada execução rotaciona OUTRA vez,
  // deixando o serviço com um token a mais de atraso a cada tentativa.
  const entregue = result.action === "provisioned" && result.delivered;

  await audit(
    extractAuditContextFromRequest(req, params.orgId, session.user.id),
    {
      action: "ORG_MAX_ACTIVATED",
      result: entregue ? "SUCCESS" : "FAILURE",
      resourceType: "organization",
      resource: params.orgId,
      // `forced` distingue no audit o que foi rotação deliberada do que foi
      // ativação do dono — as duas gravam a mesma action e teriam a mesma cara.
      metadata: { forced: true, ...result },
    }
  );

  return NextResponse.json({
    ok: true,
    delivered: entregue,
    action: result.action,
    detail: result.action === "provisioned" ? result.detail : undefined,
  });
}
