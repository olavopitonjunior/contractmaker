#!/usr/bin/env tsx
/**
 * F3 verification — testa:
 *   1. Routing "Proponha" → intent=propose → curator + legal
 *   2. graph.getStateHistory devolve checkpoints
 *   3. getTimeline retorna timeline unificada
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(): void {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

import { prisma } from "../src/lib/db/prisma";
import { runOrchestrator, getOrchestratorGraph } from "../src/lib/ai/orchestrator/graph";
import { classifyIntent } from "../src/lib/ai/orchestrator/routing";
import { getTimeline } from "../src/lib/ai/multi-agent-memory";
import type { ToolCallRecord } from "../src/lib/ai/orchestrator/state";

async function pickContract() {
  const candidates = await prisma.contract.findMany({
    where: { status: "rascunho", googleDocId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      deal: { include: { pipeline: { select: { orgId: true } } } },
      template: { select: { name: true, modalidade: true } },
      clauses: { where: { isActive: true } },
    },
  });
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const d = c.dataJson as Record<string, unknown>;
    let score = 0;
    score += ((d.vendedores as unknown[] | undefined)?.length ?? 0) * 3;
    score += ((d.compradores as unknown[] | undefined)?.length ?? 0) * 3;
    score += ((d.imoveis as unknown[] | undefined)?.length ?? 0) * 2;
    if ((d.pagamento as { valor_total?: number } | undefined)?.valor_total) score += 5;
    score += c.clauses.length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

async function main() {
  console.log("🧪 F3 — Curator reachable + getStateHistory + timeline\n");

  const question = "Proponha uma melhoria no padrão de cláusula de multa baseada em contratos similares aprovados pela organização.";
  const intent = classifyIntent(question);
  console.log(`📝 Pergunta: ${question}`);
  console.log(`🎯 Intent classificado: ${intent}`);
  console.log(`   (esperado: 'propose' → roteia pra [legal, curator])\n`);

  const contract = await pickContract();
  const orgId = contract.deal?.pipeline?.orgId;
  if (!orgId) throw new Error("Contrato sem orgId");
  console.log(`📄 Contrato: ${contract.id} (template=${contract.template?.name})\n`);

  // 1. Rodar orchestrator
  console.log("─".repeat(72));
  console.log("ETAPA 1 — Rodando orchestrator");
  console.log("─".repeat(72));

  let agentsUsed = new Set<string>();
  let toolCalls = 0;
  let finalMessage = "";
  const t0 = Date.now();

  for await (const event of runOrchestrator({
    contractId: contract.id,
    userId: contract.userId,
    orgId,
    userMessage: question,
    mode: "plan",
  })) {
    const e = event as Record<string, unknown>;
    if (e.type === "agent_started") agentsUsed.add(String(e.agent));
    if (e.type === "tool_use") {
      toolCalls++;
      console.log(`  🔧 tool_use: ${e.name}`);
    }
    if (e.type === "tool_result") {
      console.log(`  ${e.success ? "✓" : "✗"} ${e.name}: ${e.summary}`);
    }
    if (e.type === "agent_completed") {
      console.log(`  ✅ ${e.agent} completed`);
    }
    if (e.type === "text_delta") finalMessage += String(e.text ?? "");
  }

  console.log(`\n📊 Latência: ${Date.now() - t0}ms`);
  console.log(`📊 Agents usados: [${[...agentsUsed].join(", ")}]`);
  console.log(`📊 Tool calls: ${toolCalls}`);
  console.log(`📊 Resposta: ${finalMessage.length} chars`);
  console.log(`\nCurator no time? ${agentsUsed.has("curator") ? "✅ SIM" : "❌ NÃO"}`);

  // 2. Ler checkpoints via graph.getStateHistory
  console.log("\n" + "─".repeat(72));
  console.log("ETAPA 2 — graph.getStateHistory (PostgresSaver)");
  console.log("─".repeat(72));

  const sessionRow = await prisma.chatSession.findFirst({
    where: { contractId: contract.id, archived: false },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!sessionRow) {
    console.log("❌ Nenhuma session encontrada");
    await prisma.$disconnect();
    return;
  }

  const graph = getOrchestratorGraph();
  let checkpointCount = 0;
  const checkpointSamples: Array<{ step: number | null; nextNodes: string[]; intent: string | null; agents: string[]; tools: number }> = [];
  for await (const snapshot of graph.getStateHistory({ configurable: { thread_id: sessionRow.id } })) {
    checkpointCount++;
    const values = snapshot.values as Record<string, unknown>;
    const metadata = (snapshot as { metadata?: { step?: number } }).metadata;
    const specialistOutputs =
      (values.specialistOutputs as Record<string, { toolCalls?: ToolCallRecord[] }>) ?? {};
    const agents = Object.keys(specialistOutputs);
    let toolsTotal = 0;
    for (const out of Object.values(specialistOutputs)) {
      toolsTotal += (out.toolCalls ?? []).length;
    }
    if (checkpointSamples.length < 5) {
      checkpointSamples.push({
        step: metadata?.step ?? null,
        nextNodes: Array.isArray(snapshot.next) ? (snapshot.next as string[]) : [],
        intent: (values.intent as string) ?? null,
        agents,
        tools: toolsTotal,
      });
    }
  }
  console.log(`📊 Checkpoints encontrados: ${checkpointCount}`);
  console.log(`📊 Primeiros 5 (mais novos primeiro):`);
  checkpointSamples.forEach((s, i) => {
    console.log(
      `   ${i + 1}. step=${s.step} intent=${s.intent ?? "?"} agents=[${s.agents.join(",")}] tools=${s.tools} next=[${s.nextNodes.join(",")}]`
    );
  });

  // 3. Timeline unificada via multi-agent-memory
  console.log("\n" + "─".repeat(72));
  console.log("ETAPA 3 — getTimeline (AuditLog + AIUsage + ChangeLog)");
  console.log("─".repeat(72));

  const timeline = await getTimeline(contract.id, { limit: 15 });
  console.log(`📊 Timeline entries (limite 15, mais novos primeiro):`);
  for (const entry of timeline) {
    console.log(
      `   [${entry.kind.padEnd(20)}] ${entry.at.toISOString().slice(11, 19)} · ${entry.agent ?? "—"} · ${entry.summary.slice(0, 100)}`
    );
  }

  console.log("\n" + "═".repeat(72));
  console.log("✅ F3 verification concluída");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Script falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
