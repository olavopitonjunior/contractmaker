import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { PageHeader } from "@/components/layout/page-header";
import { AiAgentsClient } from "./AiAgentsClient";
import { MaxAgentCard } from "@/components/settings/MaxAgentCard";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { getMaxReach } from "@/lib/max/reach";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agentes de IA" };

/**
 * Agentes de IA na visão da imobiliária.
 *
 * Instruções + escopo de base de conhecimento. Modelo, fallback, teto de custo
 * e liga/desliga são da plataforma (/admin/agents) — antes o tenant escolhia o
 * modelo aqui mesmo, na aba "Agente IA" de /settings, e essa escolha saiu de
 * propósito.
 */
export default async function AiAgentsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const userId = await getEffectiveUserId(session.user.id);
  const org = await getUserOrg(userId);
  if (!org) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agentes de IA" description="Sem organização." />
      </div>
    );
  }

  const membership = await prisma.orgMembership.findFirst({
    where: { orgId: org.id, userId },
    select: { role: true },
  });
  const canEdit = membership?.role === "owner" || membership?.role === "admin";

  // Estado do Max lido no servidor: o card é o ÚNICO lugar onde o dono vê a
  // diferença entre "ativei" e "alguém recebe". A conta de alcance vem de
  // `getMaxReach`, a MESMA usada pela etapa do onboarding — as duas telas
  // afirmam o mesmo número por construção.
  const modules = await getOrgModules(org.id);
  const maxAvailable =
    isFeatureEnabled(modules, FEATURE.VENDAS_MAX) ||
    isFeatureEnabled(modules, FEATURE.LOCACAO_MAX);

  const [prov, alcance] = maxAvailable
    ? await Promise.all([
        prisma.agentProvisioning.findUnique({
          where: { orgId_agentKey: { orgId: org.id, agentKey: "max" } },
          select: { status: true, deliveredAt: true, lastError: true },
        }),
        getMaxReach(org.id),
      ])
    : [null, { membersTotal: 0, membersWithPhone: 0, optedIn: 0 }];

  const maxState = {
    available: maxAvailable,
    // `deliveredAt` e nao so `status`: "ativo sem confirmacao" e o estado das
    // orgs provisionadas por script, e nao e entrega observada.
    active: prov?.status === "active" && prov.deliveredAt != null,
    lastError: prov?.lastError ?? null,
    ...alcance,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agentes de IA"
        description="Instruções adicionais e qual parte da base de conhecimento cada agente consulta. As instruções são somadas às regras da plataforma — nunca as substituem. Modelo e limites de custo são configurados pela plataforma."
      />
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Somente proprietários e administradores da organização podem editar.
        </p>
      )}
      <MaxAgentCard state={maxState} canEdit={canEdit} />
      <AiAgentsClient canEdit={canEdit} />
    </div>
  );
}
