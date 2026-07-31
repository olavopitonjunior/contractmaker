import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiInsightsConfigForm } from "@/components/settings/AiInsightsConfigForm";
import { DEFAULT_CONFIG, type AiInsightsConfig } from "./types";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { getEffectiveUserId } from "@/lib/auth/impersonation";

export const dynamic = "force-dynamic";

const CONTEXT_LABELS = ["dashboard", "contract", "property", "cashflow"] as const;

export default async function AiInsightsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  // Impersonation: sob "trocar de tenant", quem resolve membership/RBAC é o dono
  // do tenant, não o super_admin (ver lib/auth/impersonation.ts).
  const effUserId = await getEffectiveUserId(session.user.id);

  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  const isOwner = membership?.role === "owner";

  // Migrado de AgentConfig.aiInsightsConfig pro perfil `insights`.
  const profile = await resolveAgentProfile("insights", org.id);
  const raw = profile.config as Partial<AiInsightsConfig> | null | undefined;
  const config: AiInsightsConfig = {
    // O kill switch do console desliga tudo, independente do toggle da org.
    enabled: profile.enabled ? raw?.enabled ?? DEFAULT_CONFIG.enabled : false,
    contexts: {
      dashboard: raw?.contexts?.dashboard ?? true,
      contract: raw?.contexts?.contract ?? true,
      property: raw?.contexts?.property ?? true,
      cashflow: raw?.contexts?.cashflow ?? true,
    },
  };

  // Métricas do mês corrente: AIUsage com operation insights_*.
  const now = new Date();
  const startOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const usage = await prisma.aIUsage.findMany({
    where: {
      orgId: org.id,
      createdAt: { gte: startOfMonth },
      operation: { startsWith: "insights_" },
    },
    select: {
      operation: true,
      estimatedCostUsd: true,
      success: true,
      totalTokens: true,
    },
  });

  const totalCalls = usage.length;
  const successCalls = usage.filter((u) => u.success).length;
  const totalCostUsd = usage.reduce((acc, u) => acc + Number(u.estimatedCostUsd ?? 0), 0);
  const totalTokens = usage.reduce((acc, u) => acc + (u.totalTokens ?? 0), 0);
  const avgCostUsd = totalCalls > 0 ? totalCostUsd / totalCalls : 0;
  const successRate = totalCalls > 0 ? (successCalls / totalCalls) * 100 : 0;

  const byContext = new Map<string, { calls: number; cost: number }>();
  for (const u of usage) {
    const ctx = u.operation.replace("insights_", "");
    const cur = byContext.get(ctx) ?? { calls: 0, cost: 0 };
    cur.calls += 1;
    cur.cost += Number(u.estimatedCostUsd ?? 0);
    byContext.set(ctx, cur);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">AI Insights</h1>
        <p className="text-sm text-muted-foreground">
          Configure quando o sistema mostra observações geradas por IA e acompanhe o
          custo. Roda em Haiku 4.5 com cache de 30min.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Chamadas (mês)</div>
            <div className="text-xl font-semibold">{totalCalls}</div>
            <div className="text-xs text-muted-foreground">
              {successRate.toFixed(0)}% sucesso
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Custo USD (mês)</div>
            <div className="text-xl font-semibold">${totalCostUsd.toFixed(4)}</div>
            <div className="text-xs text-muted-foreground">
              Médio ${avgCostUsd.toFixed(5)}/insight
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Tokens (mês)</div>
            <div className="text-xl font-semibold">{totalTokens.toLocaleString("pt-BR")}</div>
            <div className="text-xs text-muted-foreground">prompt + completion</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Cache TTL</div>
            <div className="text-xl font-semibold">30 min</div>
            <div className="text-xs text-muted-foreground">por contexto + hash dados</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuração</CardTitle>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <AiInsightsConfigForm initialConfig={config} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Apenas owners da organização podem alterar configurações de IA. Você consegue
              acompanhar as métricas acima.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custo por contexto (mês)</CardTitle>
        </CardHeader>
        <CardContent>
          {byContext.size === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem chamadas registradas neste mês ainda.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Contexto</th>
                  <th className="py-2 text-right">Chamadas</th>
                  <th className="py-2 text-right">Custo USD</th>
                </tr>
              </thead>
              <tbody>
                {CONTEXT_LABELS.map((ctx) => {
                  const m = byContext.get(ctx);
                  return (
                    <tr key={ctx} className="border-b last:border-b-0">
                      <td className="py-2 capitalize">{ctx}</td>
                      <td className="py-2 text-right">{m?.calls ?? 0}</td>
                      <td className="py-2 text-right">${(m?.cost ?? 0).toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
