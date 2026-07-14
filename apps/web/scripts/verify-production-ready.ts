/**
 * verify-production-ready.ts
 *
 * Checklist automatizado para confirmar que o sistema está pronto para
 * processar a primeira cobrança real em Asaas produção. Roda 25+ checks
 * de env vars, DB, integrações externas, hard-stops e documentos legais.
 *
 * Uso:
 *   ASAAS_ENV=production npx tsx scripts/verify-production-ready.ts
 *   npx tsx scripts/verify-production-ready.ts --base-url https://web-olavopiton-4477s-projects.vercel.app
 *
 * Exit code:
 *   0 — todos os checks passaram (ou apenas warnings)
 *   1 — pelo menos 1 check crítico falhou
 *
 * NÃO modifica state. Pode rodar em produção com segurança.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Carrega .env.production.local (gerado por `vercel env pull`) sem dotenv.
// Usa `vercel env pull --environment=production` antes de rodar este script.
{
  const envFile = resolve(process.cwd(), ".env.production.local");
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Remove surrounding quotes (Vercel env pull wraps values with ")
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

interface CheckResult {
  category: string;
  name: string;
  severity: "ok" | "warning" | "critical";
  message: string;
  durationMs?: number;
}

const results: CheckResult[] = [];
const startTime = Date.now();

function ok(category: string, name: string, message = "OK") {
  results.push({ category, name, severity: "ok", message });
}
function warn(category: string, name: string, message: string) {
  results.push({ category, name, severity: "warning", message });
}
function fail(category: string, name: string, message: string) {
  results.push({ category, name, severity: "critical", message });
}

function checkEnvVar(name: string, opts: { required?: boolean; pattern?: RegExp } = {}) {
  const value = process.env[name];
  if (!value) {
    if (opts.required === false) {
      warn("env", name, "Não definida (opcional)");
    } else {
      fail("env", name, "Não definida");
    }
    return;
  }
  // Detect trailing newline corruption (incidente 2026-04-20)
  if (/\\n$/.test(value) || /\n$/.test(value)) {
    fail("env", name, "Contém '\\n' literal no fim — env var corrompida (re-add via printf '%s')");
    return;
  }
  if (opts.pattern && !opts.pattern.test(value)) {
    fail("env", name, `Formato inválido — esperado padrão ${opts.pattern}`);
    return;
  }
  ok("env", name);
}

async function main() {
  const args = process.argv.slice(2);
  const baseUrl =
    args.find((a) => a.startsWith("--base-url="))?.slice("--base-url=".length) ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  console.log(`🔍 verify-production-ready — base URL: ${baseUrl}\n`);

  // ============== 1. ENV VARS ==============
  console.log("→ Verificando env vars...");
  checkEnvVar("DATABASE_URL", { pattern: /^postgres(ql)?:\/\// });
  checkEnvVar("DIRECT_URL", { pattern: /^postgres(ql)?:\/\// });
  checkEnvVar("AUTH_SECRET");
  checkEnvVar("NEXTAUTH_URL", { pattern: /^https?:\/\// });
  checkEnvVar("ASAAS_API_KEY");
  checkEnvVar("ASAAS_WEBHOOK_TOKEN");
  checkEnvVar("MASTER_ENCRYPTION_KEY");
  checkEnvVar("CHALLENGE_TOKEN_SECRET");
  checkEnvVar("TRUSTED_DEVICE_SECRET");
  checkEnvVar("SUDO_TOKEN_SECRET");
  // As envs de e-mail dependem do provider: em SMTP (produção) não existe
  // RESEND_API_KEY, e exigi-la reprovaria uma config saudável.
  if ((process.env.EMAIL_PROVIDER ?? "resend") === "smtp") {
    checkEnvVar("SMTP_HOST");
    checkEnvVar("SMTP_USER");
    checkEnvVar("SMTP_PASS");
  } else {
    checkEnvVar("RESEND_API_KEY");
  }
  checkEnvVar("EMAIL_FROM");
  checkEnvVar("UPSTASH_REDIS_REST_URL", { pattern: /^https:\/\// });
  checkEnvVar("UPSTASH_REDIS_REST_TOKEN");
  checkEnvVar("BLOB_READ_WRITE_TOKEN");
  checkEnvVar("CRON_SECRET", { required: false });
  checkEnvVar("VOYAGE_API_KEY", { required: false });
  checkEnvVar("ANTHROPIC_API_KEY");
  checkEnvVar("GEMINI_API_KEY", { required: false });

  // ============== 2. ASAAS_ENV ==============
  console.log("→ Verificando ambiente Asaas...");
  const asaasEnv = process.env.ASAAS_ENV;
  if (asaasEnv === "production") {
    ok("asaas", "ASAAS_ENV", "production");
  } else if (asaasEnv === "sandbox") {
    fail("asaas", "ASAAS_ENV", "Ainda está em SANDBOX — troque para 'production' antes de cobrar real");
  } else {
    fail("asaas", "ASAAS_ENV", `Valor desconhecido: '${asaasEnv ?? "undefined"}' (esperado: 'production')`);
  }

  const apiKey = process.env.ASAAS_API_KEY ?? "";
  if (asaasEnv === "production" && !apiKey.startsWith("$aact_prod_")) {
    fail("asaas", "ASAAS_API_KEY format", "Key não começa com '$aact_prod_' mas ASAAS_ENV=production");
  } else if (asaasEnv === "sandbox" && !apiKey.startsWith("$aact_hmlg_")) {
    warn("asaas", "ASAAS_API_KEY format", "Key não começa com '$aact_hmlg_' em sandbox — verificar");
  }

  // ============== 3. DB CONNECTION ==============
  console.log("→ Verificando DB...");
  let prisma;
  try {
    const { prisma: p } = await import("../src/lib/db/prisma");
    prisma = p;
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    results.push({
      category: "database",
      name: "connection",
      severity: "ok",
      message: "Conexão OK",
      durationMs: Date.now() - dbStart,
    });
  } catch (err) {
    fail("database", "connection", err instanceof Error ? err.message : String(err));
  }

  // Migration count
  if (prisma) {
    try {
      const migrations = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int as count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      `;
      const count = migrations[0]?.count ?? 0;
      if (count >= 28) {
        ok("database", "migrations", `${count} aplicadas`);
      } else {
        fail("database", "migrations", `Apenas ${count} aplicadas — esperado >= 28`);
      }
    } catch (err) {
      warn("database", "migrations", "Não foi possível verificar contagem");
    }
  }

  // ============== 4. ASAAS REACHABILITY ==============
  if (apiKey && asaasEnv) {
    console.log("→ Verificando Asaas reachability...");
    const asaasBase =
      asaasEnv === "production" ? "https://api.asaas.com" : "https://api-sandbox.asaas.com";
    try {
      const res = await fetch(`${asaasBase}/v3/myAccount/status`, {
        headers: { access_token: apiKey },
      });
      if (!res.ok) {
        fail("asaas", "myAccount/status", `HTTP ${res.status}`);
      } else {
        const json: any = await res.json();
        if (json.general === "APPROVED") {
          ok("asaas", "myAccount status", `general=APPROVED, banking=${json.bankAccountInfo}, docs=${json.documentation}`);
        } else {
          fail(
            "asaas",
            "myAccount status",
            `general=${json.general} — subconta não está APPROVED ainda`
          );
        }
      }
    } catch (err) {
      fail("asaas", "reachability", err instanceof Error ? err.message : String(err));
    }

    // Webhook cadastrado
    try {
      const res = await fetch(`${asaasBase}/v3/webhooks`, {
        headers: { access_token: apiKey },
      });
      if (res.ok) {
        const json: any = await res.json();
        const webhooks = json.data ?? [];
        const enabled = webhooks.filter((w: any) => w.enabled);
        if (enabled.length === 0) {
          fail("asaas", "webhooks", "Nenhum webhook enabled — cadastre antes de cobrar real");
        } else {
          ok("asaas", "webhooks", `${enabled.length} webhook(s) enabled`);
        }
      } else {
        warn("asaas", "webhooks", `HTTP ${res.status} ao listar`);
      }
    } catch {
      warn("asaas", "webhooks", "Falha na listagem");
    }
  }

  // ============== 5. PRODUCTION HARD-STOPS ==============
  if (asaasEnv === "production") {
    console.log("→ Verificando hard-stops sandbox...");
    // /api/admin/sandbox/* devem retornar 403 em production
    try {
      const res = await fetch(`${baseUrl}/api/admin/sandbox/confirm-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asaasPaymentId: "pay_should_403" }),
      });
      if (res.status === 403) {
        ok("hard-stops", "sandbox/confirm-payment", "403 (esperado)");
      } else {
        fail(
          "hard-stops",
          "sandbox/confirm-payment",
          `Esperado 403 em prod, recebeu ${res.status}`
        );
      }
    } catch (err) {
      warn(
        "hard-stops",
        "sandbox/confirm-payment",
        `Não conseguiu pingar (${err instanceof Error ? err.message : err})`
      );
    }

    try {
      const res = await fetch(`${baseUrl}/api/admin/sandbox/seed-paid-charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.status === 403) {
        ok("hard-stops", "sandbox/seed-paid-charge", "403 (esperado)");
      } else {
        fail(
          "hard-stops",
          "sandbox/seed-paid-charge",
          `Esperado 403 em prod, recebeu ${res.status}`
        );
      }
    } catch {
      warn("hard-stops", "sandbox/seed-paid-charge", "Não conseguiu pingar");
    }
  }

  // ============== 6. LGPD ENDPOINTS ==============
  console.log("→ Verificando endpoints LGPD...");
  for (const path of ["/privacy", "/terms"]) {
    try {
      const res = await fetch(`${baseUrl}${path}`);
      if (res.ok) {
        ok("lgpd", `page ${path}`, "200");
      } else {
        warn("lgpd", `page ${path}`, `HTTP ${res.status} — publicar antes de cobrar real`);
      }
    } catch {
      warn("lgpd", `page ${path}`, "Não acessível");
    }
  }

  // /api/me/data-export sem auth deve retornar 401 (= endpoint registered)
  try {
    const res = await fetch(`${baseUrl}/api/me/data-export`);
    if (res.status === 401) {
      ok("lgpd", "data-export endpoint", "401 sem auth (registrado)");
    } else if (res.status === 404) {
      fail("lgpd", "data-export endpoint", "404 — endpoint não existe (PR-3 não deployada)");
    } else {
      warn("lgpd", "data-export endpoint", `HTTP ${res.status}`);
    }
  } catch {
    warn("lgpd", "data-export endpoint", "Não acessível");
  }

  // ============== 7. PREFLIGHT EXTERNO ==============
  // Não precisa rodar — baseUrl pode estar atrás de auth e precisaria de cookie.
  // Documentado no runbook que o admin roda manualmente após login.

  // ============== RESUMO ==============
  const totalDuration = Date.now() - startTime;
  console.log("\n" + "=".repeat(60));
  console.log("RESULTADOS:");
  console.log("=".repeat(60));

  const byCategory: Record<string, CheckResult[]> = {};
  for (const r of results) {
    (byCategory[r.category] ??= []).push(r);
  }

  for (const cat of Object.keys(byCategory)) {
    console.log(`\n[${cat}]`);
    for (const r of byCategory[cat]) {
      const icon =
        r.severity === "ok" ? "✓" : r.severity === "warning" ? "⚠" : "✗";
      const color =
        r.severity === "ok" ? "\x1b[32m" : r.severity === "warning" ? "\x1b[33m" : "\x1b[31m";
      const reset = "\x1b[0m";
      console.log(`  ${color}${icon}${reset} ${r.name}: ${r.message}`);
    }
  }

  const criticals = results.filter((r) => r.severity === "critical").length;
  const warnings = results.filter((r) => r.severity === "warning").length;
  const oks = results.filter((r) => r.severity === "ok").length;

  console.log("\n" + "=".repeat(60));
  console.log(
    `Total: ${oks} OK · ${warnings} warning · ${criticals} crítico (${totalDuration}ms)`
  );

  if (criticals > 0) {
    console.log("\n\x1b[31m✗ NÃO ESTÁ PRONTO PARA PRODUÇÃO\x1b[0m");
    console.log("Resolva os checks críticos antes de cobrar real.");
    process.exit(1);
  } else if (warnings > 0) {
    console.log("\n\x1b[33m⚠ Pronto com ressalvas — revise os warnings\x1b[0m");
    process.exit(0);
  } else {
    console.log("\n\x1b[32m✓ PRONTO PARA PRODUÇÃO\x1b[0m");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exit(1);
});
