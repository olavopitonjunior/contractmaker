import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { syncMaxForOrg } from "@/lib/max/provisioning";

export const dynamic = "force-dynamic";

/**
 * POST /api/org/max/activate
 *
 * Ativa (ou reconecta) o Max para a própria imobiliária, **sem super_admin**.
 *
 * Duas chaves, de propósito:
 *  - o **super_admin** torna o canal DISPONÍVEL ligando `vendas.max`/`locacao.max`
 *    em `/admin/orgs`. O Max compartilha um número e uma instância Z-API entre
 *    tenants, então capacidade e custo continuam com quem paga a conta;
 *  - o **dono** ativa aqui, com `ORG_SETTINGS_EDIT` — o mesmo padrão de todo o
 *    resto de `/settings/*`, onde a imobiliária se configura sozinha.
 *
 * Sem a feature disponível responde 409 e **não provisiona**: seria emitir
 * credencial para um canal que o tenant não contratou.
 *
 * `syncMaxForOrg` é idempotente e é o MESMO caminho do painel admin — inclusive
 * a gravação de `AgentProvisioning`. Por isso este endpoint serve às duas
 * situações que o dono vive: nunca ativou, ou ativou e a entrega ao serviço
 * falhou (o cron de reconciliação também conserta, mas em até uma hora; aqui é
 * na hora, com quem está olhando a tela).
 *
 * O que ele NÃO faz, e é o ponto que mais confunde: ativar o Max **não** liga
 * WhatsApp para ninguém. Cada pessoa precisa ter telefone no perfil e optar por
 * receber — opt-in pessoal, LGPD, "a imobiliária pode desligar, nunca ligar por
 * ele" (`NotificationChannelsCard`). A etapa do onboarding mede exatamente isso.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    const effUserId = await getEffectiveUserId(ctx.userId);
    await requirePermission({
      userId: effUserId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_EDIT,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const modules = await getOrgModules(ctx.orgId);
  const disponivel =
    isFeatureEnabled(modules, FEATURE.VENDAS_MAX) ||
    isFeatureEnabled(modules, FEATURE.LOCACAO_MAX);

  if (!disponivel) {
    return NextResponse.json(
      {
        error: "MAX_NOT_AVAILABLE",
        reason:
          "O Max ainda não está disponível para esta imobiliária. Fale com o suporte para liberar o canal.",
      },
      { status: 409 }
    );
  }

  const result = await syncMaxForOrg(ctx.orgId);

  // `delivered: false` NÃO é erro de requisição: o token foi emitido e é
  // válido; o que faltou foi a entrega ao serviço, que o cron reconcilia. Um
  // 500 aqui faria o dono clicar de novo achando que nada aconteceu — e cada
  // clique ROTACIONA o token, porque `createApiToken` não é idempotente.
  const entregue = result.action === "provisioned" && result.delivered;

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "ORG_MAX_ACTIVATED",
    result: entregue ? "SUCCESS" : "FAILURE",
    resourceType: "organization",
    resource: ctx.orgId,
    metadata: { ...result },
  });

  return NextResponse.json({
    ok: true,
    delivered: entregue,
    detail: result.action === "provisioned" ? result.detail : undefined,
  });
}
