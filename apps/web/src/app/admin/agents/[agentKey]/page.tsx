import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { AGENT_REGISTRY, isAgentKey, type AgentKey } from "@/lib/ai/agents/registry";
import { AGENT_TOOLBOXES } from "@/lib/ai/agents/toolboxes";
import { AGENT_TOOLS, DIRECT_WRITE_TOOLS, getToolNames } from "@/lib/ai/tools";
import { MCP_TOOL_NAMES } from "@/lib/ai/agents/mcp-catalog.generated";
import { AgentDetailClient, type ToolRow } from "./AgentDetailClient";

export const dynamic = "force-dynamic";

/**
 * A visão SEPARADA de um agente — abas Config / Prompt / Tools / Custo.
 * O card de config é o mesmo do console (AgentsConsoleClient com
 * onlyAgentKey); prompt vem da rota read-only; tools saem do MESMO mapa que
 * os especialistas consomem (toolboxes.ts) e do catálogo gerado do MCP.
 *
 * Os dados de tools são extraídos AQUI (server) e passados serializados: o
 * client não importa lib/ai/tools.ts, que carrega os schemas inteiros do SDK.
 */
export default async function AgentDetailPage({
  params,
}: {
  params: { agentKey: string };
}) {
  if (!isAgentKey(params.agentKey)) notFound();
  const agentKey = params.agentKey as AgentKey;
  const def = AGENT_REGISTRY[agentKey];

  const session = await auth();
  // O layout já barrou quem não é staff; aqui só decidimos o canEdit e se a
  // aba Prompt aparece (super_admin, mesmo gate da rota que ela consome).
  const platformRole = session?.user?.id
    ? await getPlatformRole(session.user.id)
    : null;
  const isSuperAdmin = platformRole?.role === "super_admin";

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const descriptions = new Map(
    AGENT_TOOLS.map((t) => [t.name, t.description ?? ""])
  );
  const toRow = (name: string): ToolRow => ({
    name,
    write: DIRECT_WRITE_TOOLS.has(name),
    description: descriptions.get(name)?.slice(0, 240) ?? null,
  });

  // chat_legacy usa o toolbox COMPLETO (com o gate do modo Planejar podando
  // writes em runtime); max expõe o catálogo do MCP; quem tem entrada no mapa
  // usa a entrada; o resto genuinamente não tem tools.
  let tools: ToolRow[] = [];
  let toolsNote: string | null = null;
  if (agentKey === "chat_legacy") {
    tools = getToolNames().map(toRow);
    toolsNote =
      "Toolbox completo do agente legado. Em modo Planejar, os writes diretos são podados em runtime (gate do plan-and-approve).";
  } else if (agentKey === "max") {
    tools = MCP_TOOL_NAMES.map((n) => ({ name: n, write: false, description: null }));
    toolsNote =
      "Catálogo do MCP server (apps/mcp-server), gerado por npm run gen:mcp-catalog. A separação consulta × ativação é imposta pelos scopes do token, não por este catálogo.";
  } else if (AGENT_TOOLBOXES[agentKey]) {
    tools = [...AGENT_TOOLBOXES[agentKey]!].map(toRow);
  } else {
    toolsNote =
      "Este agente não usa tools: chama o modelo direto (análise passiva, insights, suporte, síntese) ou roda fora do toolbox (OCR no Gemini).";
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <p className="text-xs text-muted-foreground">
          <a href="/admin/agents" className="hover:underline">
            Agentes de IA
          </a>{" "}
          / {def.label}
        </p>
        <h1 className="font-display text-2xl font-semibold">{def.label}</h1>
        <p className="text-sm text-muted-foreground">{def.description}</p>
      </header>
      <AgentDetailClient
        agentKey={agentKey}
        canEdit={isSuperAdmin}
        showPrompt={isSuperAdmin}
        orgs={orgs}
        tools={tools}
        toolsNote={toolsNote}
      />
    </div>
  );
}
