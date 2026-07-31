import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { AgentsConsoleClient } from "./AgentsConsoleClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agentes de IA — Admin" };

/**
 * Console de agentes de IA. Substitui /admin/agent-defaults (que só cobria os
 * 4 especialistas do orquestrador) e a aba de config de /admin/support-ai.
 *
 * Duas dimensões: agente × escopo (plataforma | tenant). Modelo, fallback,
 * teto de custo e liga/desliga vivem aqui; o tenant escreve instruções e o
 * escopo de RAG da própria org, em /settings/ai-agents.
 *
 * Gated por PlatformRole — leitura pra `support`, edição pra `super_admin`
 * (imposto também na API /api/admin/agents).
 */
export default async function AgentsConsolePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  const canEdit = platformRole.role === "super_admin";
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Agentes de IA</h1>
        <p className="text-sm text-muted-foreground">
          Modelo, fallback, teto de custo, instruções e{" "}
          <strong>escopo de base de conhecimento</strong> de cada agente — no
          padrão da plataforma ou como override de um tenant. As{" "}
          <strong>instruções</strong> são APENDADAS ao prompt-base (que já se
          adapta a venda × locação), nunca o substituem. O{" "}
          <strong>modelo</strong>, esse sim, substitui. Agente que não consulta a
          base aparece com o escopo desabilitado. Mudanças pegam em ≤1 min
          (cache de resolução).
        </p>
      </header>
      <AgentsConsoleClient canEdit={canEdit} orgs={orgs} />
    </div>
  );
}
