#!/usr/bin/env tsx
/**
 * F4.x polish — testa 1-turn aditamento:
 *   - Mensagem: "Proponha um aditamento baseado nas certidões"
 *   - Routing: ADITAMENTO_REGEX força edit_simple → Editor
 *   - Editor chama cross_check_certidoes + propose_suggestion no mesmo turn
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

async function pickDealWithCertidoes() {
  const jobsGrouped = await prisma.certidaoJob.groupBy({
    by: ["dealId"],
    where: { dealId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  for (const row of jobsGrouped) {
    if (!row.dealId) continue;
    const deal = await prisma.deal.findUnique({
      where: { id: row.dealId },
      include: {
        contracts: {
          where: { status: "rascunho", googleDocId: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        pipeline: { select: { orgId: true } },
      },
    });
    if (deal?.contracts[0]) {
      return { deal, contract: deal.contracts[0], orgId: deal.pipeline.orgId };
    }
  }
  return null;
}

async function main() {
  console.log("🧪 F4.x polish E2E — 1-turn aditamento por certidões\n");

  const target = await pickDealWithCertidoes();
  if (!target) {
    console.log("⚠️  Nenhum deal com certidões + contrato rascunho. Skip.");
    await prisma.$disconnect();
    return;
  }

  const { contract, orgId } = target;
  console.log(`📄 Contrato: ${contract.id}\n`);

  const question =
    "Proponha um aditamento baseado nas certidões emitidas — leia a matrícula e os documentos do vendedor, e proponha sugestões de cláusula pra cobrir os ônus encontrados.";
  const intent = classifyIntent(question);
  console.log(`🎯 Intent: ${intent} (esperado edit_simple)\n`);

  let agentsUsed = new Set<string>();
  let toolsUsed: string[] = [];
  let proposeSuggestionCount = 0;
  let crossCheckInvoked = false;
  let addCommentCount = 0;
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
      const name = String(e.name);
      toolsUsed.push(name);
      console.log(`  🔧 ${name}`);
      if (name === "cross_check_certidoes") crossCheckInvoked = true;
      if (name === "propose_suggestion") proposeSuggestionCount++;
      if (name === "add_comment") addCommentCount++;
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
  console.log(`📊 Agents: [${[...agentsUsed].join(", ")}]`);
  console.log(`📊 Tools: ${toolsUsed.length} — ${toolsUsed.join(", ")}`);
  console.log(`📊 cross_check_certidoes invocada? ${crossCheckInvoked ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`📊 propose_suggestion criadas: ${proposeSuggestionCount}`);
  console.log(`📊 add_comment criados: ${addCommentCount}`);
  console.log(`📊 ContractSuggestions pending criadas no DB: ${await prisma.contractSuggestion.count({ where: { contractId: contract.id, status: "pending" } })}`);

  console.log(`\n📝 Resposta (1500 chars):\n`);
  console.log(finalMessage.slice(0, 1500));
  console.log("\n═".repeat(72));
  console.log("✅ F4 polish E2E concluído");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Script falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
