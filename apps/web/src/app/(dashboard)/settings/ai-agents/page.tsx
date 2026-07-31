import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { PageHeader } from "@/components/layout/page-header";
import { AiAgentsClient } from "./AiAgentsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agentes de IA" };

/**
 * Agentes de IA na visão da imobiliária.
 *
 * Só instruções. Modelo, fallback, teto de custo e liga/desliga são da
 * plataforma (/admin/agents) — antes o tenant escolhia o modelo aqui mesmo,
 * na aba "Agente IA" de /settings, e essa escolha saiu de propósito.
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agentes de IA"
        description="Instruções adicionais para cada agente. Elas são somadas às regras da plataforma — nunca as substituem. Modelo e limites de custo são configurados pela plataforma."
      />
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Somente proprietários e administradores da organização podem editar.
        </p>
      )}
      <AiAgentsClient canEdit={canEdit} />
    </div>
  );
}
