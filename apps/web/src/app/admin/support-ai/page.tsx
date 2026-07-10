import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { SupportAiClient } from "./SupportAiClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "IA de Suporte — Admin" };

/**
 * Painel super-admin da IA de suporte ao usuário: prompt/config, base de
 * conhecimento (RAG), pendências (handoffs) e insights de qualidade. Gated por
 * PlatformRole — leitura/handoffs/KB pra `support`, edição de config pra
 * `super_admin` (imposto também nas APIs).
 */
export default async function SupportAiPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  const canEditConfig = platformRole.role === "super_admin";

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">IA de Suporte</h1>
        <p className="text-sm text-muted-foreground">
          Prompt, base de conhecimento (RAG), pendências e qualidade do assistente de
          suporte ao usuário. Você é <span className="font-medium">{platformRole.role}</span>.
        </p>
      </header>
      <SupportAiClient canEditConfig={canEditConfig} />
    </div>
  );
}
