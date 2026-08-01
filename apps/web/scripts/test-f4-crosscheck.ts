#!/usr/bin/env tsx
/**
 * F4 E2E — testa o ciclo completo de cross-check de certidões:
 *
 * Cenário 1 — Pure function: chama crossCheckCertidoes() direto contra
 * jobs reais do Neon (descobre divergências).
 *
 * Cenário 2 — Tool handler: chama executeToolHandler("cross_check_certidoes")
 * via contexto sintético.
 *
 * Cenário 3 — Orchestrator: roda `analise as certidões deste contrato`
 * → Analyst chama cross_check_certidoes → findings em add_comment.
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
import { crossCheckCertidoes } from "../src/lib/ai/crosscheck/certidoes";
import { executeToolHandler } from "../src/lib/ai/tool-handlers";
import type { AgentContext } from "../src/lib/ai/types";

async function pickDealWithCertidoes() {
  // Procura um deal que tenha CertidaoJob (qualquer status) — idealmente
  // success pra exercitar findings ricos.
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
          where: { status: "rascunho" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        pipeline: { select: { orgId: true } },
      },
    });
    if (deal?.contracts[0]) {
      return {
        deal,
        contract: deal.contracts[0],
        orgId: deal.pipeline.orgId,
        jobCount: row._count._all,
      };
    }
  }
  return null;
}

async function main() {
  console.log("🧪 F4 E2E — cross_check_certidoes ciclo completo\n");

  const target = await pickDealWithCertidoes();
  if (!target) {
    console.log("⚠️  Nenhum deal com CertidaoJob + contrato rascunho encontrado.");
    console.log("    Cenários 1-2 vão usar fixture sintético, Cenário 3 será pulado.");
    await runSyntheticTests();
    await prisma.$disconnect();
    return;
  }
  const { deal, contract, orgId, jobCount } = target;
  console.log(`📄 Deal: ${deal.id} (${deal.title}) com ${jobCount} CertidaoJob`);
  console.log(`📄 Contrato: ${contract.id}\n`);

  // ─── Cenário 1: pure function ────────────────────────────────
  console.log("─".repeat(72));
  console.log("CENÁRIO 1 — crossCheckCertidoes() pure function");
  console.log("─".repeat(72));

  const jobs = await prisma.certidaoJob.findMany({
    where: { dealId: deal.id },
    select: {
      id: true,
      endpoint: true,
      label: true,
      targetKind: true,
      targetIndex: true,
      status: true,
      resultCode: true,
      resultData: true,
      errorMessage: true,
      finishedAt: true,
      attachmentId: true,
    },
  });

  const result = crossCheckCertidoes({
    contractDataJson: contract.dataJson as Record<string, unknown>,
    jobs,
  });

  console.log(`📊 ${jobs.length} jobs lidos → ${result.findings.length} findings`);
  console.log(
    `📊 Severity: error=${result.summary.bySeverity.error} warning=${result.summary.bySeverity.warning} info=${result.summary.bySeverity.info}`
  );
  console.log(`📊 hasBlockingIssues: ${result.summary.hasBlockingIssues}\n`);

  for (const f of result.findings.slice(0, 5)) {
    console.log(`  [${f.severity.padEnd(7)}] ${f.kind} — ${f.target ?? "—"}`);
    console.log(`    ${f.message.slice(0, 140)}${f.message.length > 140 ? "…" : ""}`);
    if (f.suggested_aditamento) {
      console.log(`    💡 Aditamento sugerido (${f.suggested_aditamento.length} chars)`);
    }
    if (f.manual_action) {
      console.log(`    🔗 ${f.manual_action.label} ${f.manual_action.url ?? ""}`);
    }
  }
  if (result.findings.length > 5) {
    console.log(`  … (${result.findings.length - 5} findings adicionais)`);
  }

  // ─── Cenário 2: tool handler ─────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("CENÁRIO 2 — executeToolHandler('cross_check_certidoes')");
  console.log("─".repeat(72));

  const synthCtx: AgentContext = {
    contractId: contract.id,
    userId: contract.userId,
    orgId,
    htmlContent: contract.htmlContent ?? "",
    dataJson: contract.dataJson as Record<string, unknown>,
    activeClauses: [],
    googleDocId: contract.googleDocId,
  };

  const toolResult = await executeToolHandler(
    "cross_check_certidoes",
    { focus: "all" },
    synthCtx
  );
  console.log(`📊 Handler retornou: success=${toolResult.success} findings=${(toolResult.findings as unknown[] | undefined)?.length ?? 0}`);
  console.log(`📊 Summary: ${JSON.stringify(toolResult.summary, null, 2).slice(0, 200)}`);

  // Testa focus=matricula
  const matResult = await executeToolHandler(
    "cross_check_certidoes",
    { focus: "matricula" },
    synthCtx
  );
  console.log(`📊 focus=matricula: ${(matResult.findings as unknown[] | undefined)?.length ?? 0} findings filtradas`);

  // ─── Cenário 3: orchestrator ─────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("CENÁRIO 3 — Orchestrator com intent=review + cross_check_certidoes");
  console.log("─".repeat(72));

  const question =
    "Analise as certidões emitidas e verifique se há ônus na matrícula ou outras pendências que justifiquem aditamento contratual.";
  const intent = classifyIntent(question);
  console.log(`🎯 Intent: ${intent} (esperado review)\n`);

  let agentsUsed = new Set<string>();
  let toolsUsed: string[] = [];
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
  console.log(`📊 Tools: ${toolsUsed.length} — [${toolsUsed.join(", ")}]`);
  console.log(`📊 cross_check_certidoes invocada? ${toolsUsed.includes("cross_check_certidoes") ? "✅ SIM" : "❌ NÃO"}`);
  console.log(`📊 Resposta: ${finalMessage.length} chars\n`);

  console.log("📝 Resposta (1000 chars):");
  console.log(finalMessage.slice(0, 1000));

  console.log("\n" + "═".repeat(72));
  console.log("✅ F4 E2E concluído");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

async function runSyntheticTests() {
  // Cenário 1 sintético — jobs fakes
  console.log("\n─".repeat(72));
  console.log("CENÁRIO 1 (sintético) — crossCheckCertidoes com fixture");
  console.log("─".repeat(72));
  const r = crossCheckCertidoes({
    contractDataJson: {
      vendedores: [{ nome: "João", cpf: "111.111.111-11" }],
      compradores: [{ nome: "Maria", cpf: "222.222.222-22" }],
      imoveis: [{ rua: "Rua X", numero: "100", cidade: "SP", uf: "SP" }],
    },
    jobs: [
      {
        id: "j1",
        endpoint: "registradores/matric-obter",
        label: "Matrícula ONR",
        targetKind: "imovel",
        targetIndex: 0,
        status: "success",
        resultCode: 200,
        resultData: {
          situacao: "positiva",
          emissao: "01/05/2026",
          raw: { tem_onus: true, ha_penhora: true },
        },
        errorMessage: null,
        finishedAt: new Date(),
        attachmentId: null,
      },
      {
        id: "j2",
        endpoint: "receita-federal/pgfn",
        label: "CND Federal",
        targetKind: "vendedor",
        targetIndex: 0,
        status: "success",
        resultCode: 200,
        resultData: { situacao: "positiva", detalhes: "Dívida ativa R$ 8k" },
        errorMessage: null,
        finishedAt: new Date(),
        attachmentId: null,
      },
    ],
  });
  console.log(`📊 ${r.findings.length} findings:`);
  for (const f of r.findings) {
    console.log(`  [${f.severity}] ${f.kind} — ${f.message.slice(0, 100)}`);
  }
}

main().catch(async (err) => {
  console.error("❌ Script falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
