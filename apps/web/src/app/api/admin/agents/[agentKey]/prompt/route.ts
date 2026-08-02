import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { prisma } from "@/lib/db/prisma";
import { isAgentKey, type AgentKey } from "@/lib/ai/agents/registry";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { composeSystemPrompt } from "@/lib/ai/agents/prompt-blocks";
import {
  PASSIVE_SYSTEM_PROMPT,
  PASSIVE_SYSTEM_PROMPT_LOCACAO,
  AGGREGATOR_SYSTEM_PROMPT,
  AGGREGATOR_SYSTEM_PROMPT_LOCACAO,
} from "@/lib/ai/agents/prompt-catalog";
import { specialistPromptVariants } from "@/lib/ai/specialists/prompts-locacao";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { SUPPORT_DEFAULT_SYSTEM_PROMPT } from "@/lib/support/config";
import { INSIGHTS_SYSTEM_PROMPT } from "@/lib/ai/insights-generator";
import { COMBINED_PROMPT, PLAIN_TEXT_PROMPT } from "@/lib/ai/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/agents/[agentKey]/prompt?orgId=
 *
 * O prompt EFETIVO de um agente, montado pela MESMA composição do runtime
 * (`composeSystemPrompt`) — não uma reconstrução paralela. Até aqui nenhuma
 * tela do produto mostrava o texto que de fato vai pro modelo; o console
 * exibia (e editava) só o apêndice.
 *
 * Read-only por decisão do dono: o git segue sendo a verdade do prompt-base;
 * a edição continua sendo apêndice, no console.
 *
 * Gate `super_admin` — mais restrito que o resto do /admin (que lê com
 * `support`). O prompt-base de plataforma é propriedade intelectual do
 * produto: nem o dono do tenant o enxerga, e o console não deveria rebaixar
 * isso pro papel de leitura.
 *
 * Duas verdades que a resposta carrega pra tela não mentir:
 * - "O prompt do agente" não é uma string: especialistas, passivo e agregador
 *   têm variantes venda × locação (pickSpecialistPrompt decide por
 *   dealKind/templateModalidade). A resposta traz TODAS as variantes.
 * - `composition` diz o que `instructions` faz com a base: apêndice (regra
 *   geral), SUBSTITUIÇÃO (exceção documentada do support), nada (passivo/
 *   agregador/ocr não compõem) ou externo (max, runtime em outro repo).
 */

type Composition = "append" | "replace" | "none" | "external";

interface PromptVariant {
  /** null = vale pra todo uso; senão o rótulo (venda/locacao/contexto). */
  label: string | null;
  base: string;
  /** O texto final que vai pro modelo neste escopo (base + composição). */
  composed: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { agentKey: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  if (!isAgentKey(params.agentKey)) {
    return NextResponse.json({ error: "Agente desconhecido" }, { status: 404 });
  }
  const agentKey = params.agentKey as AgentKey;

  const orgId = req.nextUrl.searchParams.get("orgId");
  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
    }
  }

  const profile = await resolveAgentProfile(agentKey, orgId);

  let composition: Composition;
  let variants: PromptVariant[];
  let note: string | null = null;

  switch (agentKey) {
    case "analyst":
    case "legal":
    case "editor":
    case "curator": {
      const v = specialistPromptVariants(agentKey);
      composition = "append";
      variants = [
        { label: "venda", base: v.venda, composed: composeSystemPrompt(v.venda, profile) },
        { label: "locacao", base: v.locacao, composed: composeSystemPrompt(v.locacao, profile) },
      ];
      break;
    }
    case "chat_legacy":
      composition = "append";
      variants = [
        {
          label: null,
          base: DEFAULT_SYSTEM_PROMPT,
          composed: composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, profile),
        },
      ];
      break;
    case "insights":
      composition = "append";
      variants = [
        {
          label: null,
          base: INSIGHTS_SYSTEM_PROMPT,
          composed: composeSystemPrompt(INSIGHTS_SYSTEM_PROMPT, profile),
        },
      ];
      break;
    case "support":
      // Exceção documentada (schema + lib/support/config.ts): aqui
      // `instructions` SUBSTITUI a base, não apenda.
      composition = "replace";
      variants = [
        {
          label: null,
          base: SUPPORT_DEFAULT_SYSTEM_PROMPT,
          composed: profile.platformInstructions || SUPPORT_DEFAULT_SYSTEM_PROMPT,
        },
      ];
      break;
    case "passive":
      composition = "none";
      note =
        "Prompt fixo — a análise passiva não compõe instruções do console (só o liga/desliga é honrado).";
      variants = [
        { label: "venda", base: PASSIVE_SYSTEM_PROMPT, composed: PASSIVE_SYSTEM_PROMPT },
        {
          label: "locacao",
          base: PASSIVE_SYSTEM_PROMPT_LOCACAO,
          composed: PASSIVE_SYSTEM_PROMPT_LOCACAO,
        },
      ];
      break;
    case "aggregator":
      composition = "none";
      note = "Prompt fixo do passo de síntese do orquestrador — sem composição.";
      variants = [
        { label: "venda", base: AGGREGATOR_SYSTEM_PROMPT, composed: AGGREGATOR_SYSTEM_PROMPT },
        {
          label: "locacao",
          base: AGGREGATOR_SYSTEM_PROMPT_LOCACAO,
          composed: AGGREGATOR_SYSTEM_PROMPT_LOCACAO,
        },
      ];
      break;
    case "ocr":
      composition = "none";
      note =
        "Prompts fixos do Gemini. Além destes dois, há um prompt de extração por categoria de documento (EXTRACTION_PROMPTS em lib/ai/ocr.ts) — rg, matrícula, IPTU etc.";
      variants = [
        { label: "classificação + extração", base: COMBINED_PROMPT, composed: COMBINED_PROMPT },
        { label: "transcrição verbatim", base: PLAIN_TEXT_PROMPT, composed: PLAIN_TEXT_PROMPT },
      ];
      break;
    case "max":
      composition = "external";
      note =
        "O runtime do Max é externo (LangGraph, outro repo) — a persona dele não mora neste código. O que este console controla chega a ele via GET /api/agents/profile.";
      variants = [];
      break;
  }

  return NextResponse.json({
    agentKey,
    scope: orgId ? { type: "org", orgId } : { type: "platform" },
    composition,
    note,
    platformInstructions: profile.platformInstructions,
    tenantInstructions: profile.tenantInstructions,
    variants,
  });
}
