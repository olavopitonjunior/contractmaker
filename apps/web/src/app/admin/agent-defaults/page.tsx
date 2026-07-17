import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { AgentDefaultsClient } from "./AgentDefaultsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Especialistas do Editor — Admin" };

/**
 * Painel super-admin dos ESPECIALISTAS do orquestrador (Analyst/Legal/Editor/
 * Curator): override de prompt e modelo por especialista, plataforma-wide.
 * Campo vazio = fallback pro hardcoded (lib/ai/specialists/prompts*.ts).
 * Gated por PlatformRole — leitura pra `support`, edição pra `super_admin`
 * (imposto também na API /api/admin/agent-defaults).
 */
export default async function AgentDefaultsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  const canEdit = platformRole.role === "super_admin";

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">
          Especialistas do Editor (orquestrador)
        </h1>
        <p className="text-sm text-muted-foreground">
          Válido pra TODOS os tenants. O <strong>modelo</strong> substitui o
          padrão; as <strong>instruções</strong> são APENDADAS ao prompt-base do
          especialista (que já se adapta a venda × locação) — não o substituem,
          pra não perder a variante de locação. Vazio = sem override. Mudanças
          pegam em ≤1 min (cache).
        </p>
      </header>
      <AgentDefaultsClient canEdit={canEdit} />
    </div>
  );
}
