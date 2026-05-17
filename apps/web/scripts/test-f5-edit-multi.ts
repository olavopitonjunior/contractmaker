#!/usr/bin/env tsx
/**
 * F5 E2E — verifica que edit_multi roda via graph (não mais fallback legacy).
 *   - Mensagem com sinais de múltiplas edições → intent=edit_multi
 *   - Roteia pro Editor com força propose_plan
 *   - ChatPlan persistido com sessionId correto (vindo do graph)
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
import { runOrchestrator } from "../src/lib/ai/orchestrator/graph";
import { classifyIntent } from "../src/lib/ai/orchestrator/routing";

async function pickContract() {
  const contract = await prisma.contract.findFirst({
    where: { status: "rascunho", googleDocId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: {
      deal: { include: { pipeline: { select: { orgId: true } } } },
      template: { select: { name: true } },
    },
  });
  if (!contract) throw new Error("Nenhum contrato rascunho com GDoc encontrado");
  return contract;
}

async function main() {
  console.log("🧪 F5 E2E — edit_multi via graph\n");

  const contract = await pickContract();
  const orgId = contract.deal?.pipeline?.orgId;
  if (!orgId) throw new Error("Contrato sem orgId");
  console.log(`📄 Contrato: ${contract.id} — ${contract.template?.name ?? "(importado)"}\n`);

  const question =
    "Revise tudo: corrija a multa de 2% para 3%, atualize o prazo de financiamento de 30 dias para 45 dias úteis, e também adicione cláusula de FGTS se aplicável. Aplique cada uma como sugestão pra eu aprovar.";

  const intent = classifyIntent(question);
  console.log(`🎯 Intent: ${intent} (esperado edit_multi)\n`);

  let agentsUsed = new Set<string>();
  let toolsUsed: string[] = [];
  let chatPlanCreated = false;
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
      toolsUsed.push(String(e.name));
      console.log(`  🔧 ${e.name}`);
    }
    if (e.type === "tool_result") {
      console.log(`  ${e.success ? "✓" : "✗"} ${e.name}: ${e.summary}`);
    }
    if (e.type === "agent_completed") {
      console.log(`  ✅ ${e.agent} completed`);
    }
    if (e.type === "plan_proposed") {
      chatPlanCreated = true;
      console.log(`  📋 plan_proposed — planId=${e.planId}`);
    }
    if (e.type === "text_delta") finalMessage += String(e.text ?? "");
  }

  console.log(`\n📊 Latência: ${Date.now() - t0}ms`);
  console.log(`📊 Agents: [${[...agentsUsed].join(", ")}]`);
  console.log(`📊 Tools: ${toolsUsed.join(", ")}`);
  console.log(`📊 Editor invocado? ${agentsUsed.has("editor") ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`📊 propose_plan invocado? ${toolsUsed.includes("propose_plan") ? "✅ SIM" : "❌ NÃO (Editor pode ter ido direto)"}`);
  console.log(`📊 plan_proposed event emitido? ${chatPlanCreated ? "✅ SIM" : "❌ NÃO"}`);

  // Verificar ChatPlan no DB
  const sessionRow = await prisma.chatSession.findFirst({
    where: { contractId: contract.id, archived: false },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (sessionRow) {
    const plan = await prisma.chatPlan.findFirst({
      where: { sessionId: sessionRow.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true },
    });
    console.log(`📊 ChatPlan no DB: ${plan ? `✅ ${plan.id} (status=${plan.status})` : "❌ nenhum"}`);
  }

  console.log(`\n📝 Resposta (1500 chars):\n`);
  console.log(finalMessage.slice(0, 1500));
  console.log("\n═".repeat(72));
  console.log("✅ F5 E2E concluído");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Script falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
