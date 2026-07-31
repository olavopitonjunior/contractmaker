/**
 * Agentes de IA na visão do TENANT.
 *
 * O que a imobiliária controla aqui: as instruções adicionais de cada agente e
 * o escopo de RAG dele (quais categorias/tags da base ele enxerga, e se lê a
 * base da plataforma).
 * Modelo, fallback, budget e o liga/desliga ficam com o super_admin em
 * /admin/agents — instrução de agente é superfície de custo e de qualidade, e
 * antes o tenant escolhia o modelo direto em /settings (rota /api/settings/agent,
 * removida neste lote).
 *
 * O modelo resolvido é devolvido só pra LEITURA, pra a tela não mentir sobre
 * qual modelo está rodando.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { requireOrgAdmin } from "@/lib/security/org-scope";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import {
  upsertAgentProfile,
  listAgentProfiles,
  ragScopeSchema,
  RAG_SCOPE_CATEGORIES,
} from "@/lib/ai/agents/store";
import {
  AGENT_DEFINITIONS,
  isAgentKey,
  AGENT_REGISTRY,
  type AgentKey,
} from "@/lib/ai/agents/registry";

export const dynamic = "force-dynamic";

/**
 * Agentes que a org configura. Exige `tenantEditable` E que a instrução seja
 * de fato lida pelo runtime (`supports.instructions`) — oferecer um campo que
 * ninguém lê é pior que não oferecer: o usuário escreve, salva e acha que
 * mudou alguma coisa.
 */
const TENANT_AGENTS = AGENT_DEFINITIONS.filter(
  (d) => d.tenantEditable && d.supports.instructions
);

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "Sem organização" }, { status: 400 });

  const own = await listAgentProfiles(org.id);

  const agents = await Promise.all(
    TENANT_AGENTS.map(async (def) => {
      const resolved = await resolveAgentProfile(def.key, org.id);
      return {
        agentKey: def.key,
        label: def.label,
        description: def.description,
        // Só o que a org escreveu — não herda a instrução da plataforma pro
        // textarea, senão salvar duplicaria o texto no prompt.
        instructions: own.get(def.key)?.instructions ?? "",
        // Idem: só o escopo da própria org. O `resolved.ragScope` herdaria o da
        // plataforma e salvar o congelaria como se fosse escolha do tenant.
        ragScope: (own.get(def.key)?.ragScope as unknown) ?? null,
        // Escopo herdado, só pra EXIBIR: sem isto a tela escreve "consulta
        // todas" enquanto a plataforma restringe. Não vai pro editor — salvar
        // o herdado congelaria como se fosse escolha do tenant.
        inheritedRagScope: own.get(def.key)?.ragScope ? null : resolved.ragScope,
        supportsRagScope: def.supports.ragScope,
        model: resolved.model,
        enabled: resolved.enabled,
      };
    })
  );

  // Lista canônica junto: sem isso o cliente precisa de um literal próprio e
  // silenciosamente para de oferecer categoria nova (ou grava uma removida, que
  // o Zod rejeita com "Payload inválido" genérico).
  return NextResponse.json({ agents, ragCategories: RAG_SCOPE_CATEGORIES });
}

const patchSchema = z.object({
  agentKey: z.string().refine(isAgentKey, "Agente desconhecido"),
  instructions: z.string().max(20_000).optional(),
  // Ausente = não mexe; `null` = apaga o escopo e volta a herdar.
  ragScope: ragScopeSchema.optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gate = await requireOrgAdmin(session.user.id);
  if (!gate.ok) return gate.res;
  const orgId = gate.orgId;

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const agentKey = parsed.data.agentKey as AgentKey;

  const def = AGENT_REGISTRY[agentKey];
  if (parsed.data.ragScope !== undefined && !def.supports.ragScope) {
    return NextResponse.json(
      { error: "Este agente não consulta a base de conhecimento." },
      { status: 400 }
    );
  }
  if (!def.tenantEditable || !def.supports.instructions) {
    return NextResponse.json(
      { error: "Este agente é configurado pela plataforma." },
      { status: 403 }
    );
  }

  const instructions = parsed.data.instructions?.trim();
  await upsertAgentProfile({
    orgId,
    agentKey,
    patch: {
      ...(instructions === undefined ? {} : { instructions: instructions || null }),
      ...(parsed.data.ragScope === undefined ? {} : { ragScope: parsed.data.ragScope }),
    },
    updatedBy: session.user.id,
  });

  await audit(extractAuditContextFromRequest(req, orgId, session.user.id), {
    action: "AGENT_CONFIG_UPDATE",
    result: "SUCCESS",
    resourceType: "AgentProfile",
    resource: `org:${orgId}:${agentKey}`,
    metadata: {
      agentKey,
      ...(instructions === undefined ? {} : { instructionsLength: instructions.length }),
      ...(parsed.data.ragScope === undefined ? {} : { ragScope: parsed.data.ragScope }),
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
