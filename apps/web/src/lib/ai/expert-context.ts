/**
 * Pré-carrega contexto especialista que é injetado ANTES do primeiro turn do
 * chat agent. Sem isso, o agente costumava começar "às cegas" e ou (a) editava
 * direto sem consultar a memória, ou (b) gastava 2-3 iterações chamando
 * `query_knowledge_base` / `find_similar_contracts` antes de agir.
 *
 * Idempotente e cacheável (ContentMemory + Clauses + Templates não mudam dentro
 * de um turn). Retorna texto markdown pronto pra concatenar no prompt do user.
 *
 * Custo: ~1.5k tokens upfront por turn de chat, mas economiza 4-6k tokens
 * em iterações de tool-use e melhora qualidade da resposta porque o agente
 * já vê os padrões da org.
 */

import { prisma } from "@/lib/db/prisma";
import { findSimilarContracts } from "./memory";
import type { AgentContext } from "./types";

const TOP_SIMILAR_CONTRACTS = 3;
const TOP_CLAUSES = 8;
const MAX_SUMMARY_CHARS = 280;
const MAX_CLAUSE_CHARS = 220;

export async function loadExpertContext(context: AgentContext): Promise<string> {
  const [similar, clauses, templates] = await Promise.all([
    loadSimilarContracts(context),
    loadTopClauses(context),
    loadActiveTemplates(context),
  ]);

  const parts: string[] = ["## CONTEXTO ESPECIALISTA (pré-carregado)"];

  if (similar.length > 0) {
    parts.push("\n### Contratos similares aprovados na sua organização");
    parts.push(
      similar
        .map((s, i) => {
          const reason: string[] = [];
          if (s.fingerprint?.modality) reason.push(`modalidade=${s.fingerprint.modality}`);
          if (s.fingerprint?.valueTotalBucket) reason.push(`faixa=${s.fingerprint.valueTotalBucket}`);
          if (s.fingerprint?.cityUf) reason.push(`local=${s.fingerprint.cityUf}`);
          const accepted = (s.acceptedSuggestions as Array<{ reason?: string }>).slice(0, 2);
          const acceptedTxt = accepted.length
            ? ` · sugestões aceitas: ${accepted
                .map((a) => `"${(a.reason || "").slice(0, 80)}"`)
                .join("; ")}`
            : "";
          const edits = (s.manualEdits as Array<{ after?: string }>)
            .slice(0, 2)
            .map((e) => (e?.after || "").trim())
            .filter((t) => t.length > 0);
          const manualTxt = edits.length
            ? ` · edições manuais frequentes: ${edits
                .map((m) => `"${m.slice(0, 60)}…"`)
                .join("; ")}`
            : "";
          return `${i + 1}. ${truncate(s.summary, MAX_SUMMARY_CHARS)} (${reason.join(", ")}${acceptedTxt}${manualTxt})`;
        })
        .join("\n")
    );
  } else {
    parts.push("\n### Contratos similares aprovados");
    parts.push("(nenhum contrato aprovado similar — este é o primeiro caso deste tipo)");
  }

  if (clauses.length > 0) {
    parts.push(`\n### Cláusulas mais usadas na biblioteca (top ${clauses.length})`);
    parts.push(
      clauses
        .map(
          (c) =>
            `- [${c.groupCode || "—"}] **${c.title}** (usada ${c.usageCount}×)${
              c.agentNotes ? ` — ${truncate(c.agentNotes, MAX_CLAUSE_CHARS)}` : ""
            }`
        )
        .join("\n")
    );
  }

  if (templates.length > 0) {
    parts.push("\n### Templates ativos");
    parts.push(
      templates
        .map((t) => `- ${t.name} (modalidade: ${t.modalidade || "n/a"}, id: ${t.id})`)
        .join("\n")
    );
  }

  parts.push(
    "\n**INSTRUÇÃO**: use este contexto pra alinhar suas edições/sugestões com o padrão da organização. " +
      "Se o pedido envolver uma cláusula listada acima, prefira reutilizá-la (via `insert_clause`) em vez " +
      "de redigir texto novo. Se há contratos similares, cite explicitamente o padrão observado " +
      "(\"em 3 contratos similares vocês usam X — vou seguir o mesmo padrão\"). Se o contexto não cobrir, " +
      "chame `find_similar_contracts` ou `query_knowledge_base` antes de agir."
  );

  return parts.join("\n");
}

async function loadSimilarContracts(context: AgentContext) {
  try {
    return await findSimilarContracts(
      context.orgId,
      context.dataJson,
      context.templateModalidade ?? null,
      context.templateName ?? null,
      undefined,
      TOP_SIMILAR_CONTRACTS
    );
  } catch (err) {
    console.error("[expert-context] findSimilarContracts falhou:", err);
    return [];
  }
}

async function loadTopClauses(context: AgentContext) {
  // Filtra por modalidade quando relevante (G4 só faz sentido em financiamento).
  const isFinanciamento = context.templateModalidade === "financiamento";
  return prisma.knowledgeItem.findMany({
    where: {
      orgId: context.orgId,
      category: "clause",
      status: "approved",
      // Em a_vista, ignora G4 (financiamento) — não é aplicável.
      ...(isFinanciamento ? {} : { groupCode: { not: "G4" } }),
    },
    select: {
      id: true,
      title: true,
      groupCode: true,
      agentNotes: true,
      usageCount: true,
    },
    orderBy: [{ usageCount: "desc" }, { title: "asc" }],
    take: TOP_CLAUSES,
  });
}

async function loadActiveTemplates(context: AgentContext) {
  return prisma.contractTemplate.findMany({
    where: { orgId: context.orgId, status: "active" },
    select: { id: true, name: true, modalidade: true },
    take: 5,
  });
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
