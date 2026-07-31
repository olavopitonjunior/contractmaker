/**
 * Agentes de IA na visão do TENANT.
 *
 * O que a imobiliária controla aqui: as instruções adicionais de cada agente.
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
import { upsertAgentProfile, listAgentProfiles } from "@/lib/ai/agents/store";
import {
  AGENT_DEFINITIONS,
  isAgentKey,
  AGENT_REGISTRY,
  type AgentKey,
} from "@/lib/ai/agents/registry";

export const dynamic = "force-dynamic";

/** Agentes que a org pode configurar (exclui suporte, OCR e o Max externo). */
const TENANT_AGENTS = AGENT_DEFINITIONS.filter((d) => d.tenantEditable);

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
        model: resolved.model,
        enabled: resolved.enabled,
      };
    })
  );

  return NextResponse.json({ agents });
}

const patchSchema = z.object({
  agentKey: z.string().refine(isAgentKey, "Agente desconhecido"),
  instructions: z.string().max(20_000),
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

  if (!AGENT_REGISTRY[agentKey].tenantEditable) {
    return NextResponse.json(
      { error: "Este agente é configurado pela plataforma." },
      { status: 403 }
    );
  }

  const instructions = parsed.data.instructions.trim();
  await upsertAgentProfile({
    orgId,
    agentKey,
    patch: { instructions: instructions || null },
    updatedBy: session.user.id,
  });

  await audit(extractAuditContextFromRequest(req, orgId, session.user.id), {
    action: "AGENT_CONFIG_UPDATE",
    result: "SUCCESS",
    resourceType: "AgentProfile",
    resource: `org:${orgId}:${agentKey}`,
    metadata: { agentKey, instructionsLength: instructions.length },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
