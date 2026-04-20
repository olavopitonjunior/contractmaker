import { prisma } from "@/lib/db/prisma";
import { pingAsaas } from "@/lib/asaas/client";

export type Severity = "ok" | "warning" | "blocker";

export interface CheckResult {
  category: string;
  key: string;
  severity: Severity;
  message: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface PreflightReport {
  ok: boolean;
  blockersCount: number;
  warningsCount: number;
  checks: CheckResult[];
  deployment: {
    vercelEnv: string | null;
    commitSha: string | null;
    branch: string | null;
    nodeEnv: string;
  };
  generatedAt: string;
}

const REQUIRED_ENVS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "ASAAS_API_KEY",
  "ASAAS_ENV",
  "ASAAS_WEBHOOK_TOKEN",
  "MASTER_ENCRYPTION_KEY",
  "CHALLENGE_TOKEN_SECRET",
  "TRUSTED_DEVICE_SECRET",
  "SUDO_TOKEN_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
] as const;

const OPTIONAL_ENVS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "VOYAGE_API_KEY",
  "INFOSIMPLES_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
] as const;

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

function envCheck(key: string, required: boolean): CheckResult {
  const val = process.env[key];
  const set = typeof val === "string" && val.length > 0;
  if (set) {
    return {
      category: "env",
      key,
      severity: "ok",
      message: "OK",
    };
  }
  return {
    category: "env",
    key,
    severity: required ? "blocker" : "warning",
    message: required
      ? "Env var obrigatória ausente"
      : "Env var opcional ausente — feature degradada",
  };
}

async function checkDatabase(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  try {
    const { ms } = await time(() => prisma.$queryRaw`SELECT 1`);
    out.push({
      category: "database",
      key: "connection",
      severity: "ok",
      message: "Conexão OK",
      durationMs: ms,
    });
  } catch (err) {
    out.push({
      category: "database",
      key: "connection",
      severity: "blocker",
      message: `Falha ao conectar: ${err instanceof Error ? err.message : String(err)}`,
    });
    return out;
  }
  try {
    const admin = await prisma.user.findUnique({
      where: { email: "admin@contractmaker.com" },
      select: { id: true, name: true },
    });
    out.push(
      admin
        ? {
            category: "database",
            key: "adminUser",
            severity: "ok",
            message: `admin@contractmaker.com existe (id ${admin.id.slice(0, 8)}…)`,
          }
        : {
            category: "database",
            key: "adminUser",
            severity: "blocker",
            message: "Usuário admin@contractmaker.com não existe — criar antes do QA",
          }
    );
  } catch (err) {
    out.push({
      category: "database",
      key: "adminUser",
      severity: "warning",
      message: `Erro ao verificar admin user: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  try {
    const orgCount = await prisma.organization.count();
    out.push({
      category: "database",
      key: "organizations",
      severity: orgCount > 0 ? "ok" : "warning",
      message: `${orgCount} organização(ões) no DB`,
      meta: { count: orgCount },
    });
  } catch {
    // já reportado em connection
  }
  return out;
}

async function checkAsaas(orgId: string | null): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  try {
    const { result, ms } = await time(() => pingAsaas());
    if (result.ok) {
      out.push({
        category: "asaas",
        key: "masterKey",
        severity: "ok",
        message: `Master API key OK (env=${result.env})`,
        durationMs: ms,
      });
    } else {
      out.push({
        category: "asaas",
        key: "masterKey",
        severity: "blocker",
        message: `Master API key inválida: ${result.error}`,
        meta: { status: result.status },
      });
      return out;
    }
  } catch (err) {
    out.push({
      category: "asaas",
      key: "masterKey",
      severity: "blocker",
      message: `Ping falhou: ${err instanceof Error ? err.message : String(err)}`,
    });
    return out;
  }

  if (!orgId) {
    out.push({
      category: "asaas",
      key: "subaccount",
      severity: "warning",
      message: "Sem org selecionada — KYC status não verificado",
    });
    return out;
  }

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId },
    select: { id: true, status: true, walletId: true, approvedAt: true },
  });
  if (!account) {
    out.push({
      category: "asaas",
      key: "subaccount",
      severity: "blocker",
      message: "AsaasAccount não existe para esta org — abrir /financeiro/onboarding",
    });
    return out;
  }
  if (account.status !== "APPROVED") {
    out.push({
      category: "asaas",
      key: "subaccount",
      severity: "blocker",
      message: `AsaasAccount.status = ${account.status}. Aprovar no dashboard Asaas sandbox.`,
      meta: { accountId: account.id },
    });
  } else {
    out.push({
      category: "asaas",
      key: "subaccount",
      severity: "ok",
      message: `Subaccount APPROVED (walletId ${account.walletId.slice(0, 8)}…)`,
    });
  }

  // Webhook: heurística por eventos recentes
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentEvents = await prisma.asaasWebhookEvent.count({
    where: { orgId, receivedAt: { gte: since } },
  });
  out.push({
    category: "asaas",
    key: "webhook",
    severity: recentEvents > 0 ? "ok" : "warning",
    message:
      recentEvents > 0
        ? `${recentEvents} evento(s) webhook nas últimas 24h`
        : "Nenhum webhook recebido em 24h — verificar dashboard Asaas → Webhooks",
    meta: { recentEvents },
  });

  return out;
}

async function checkResend(): Promise<CheckResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      category: "email",
      key: "resend",
      severity: "blocker",
      message: "RESEND_API_KEY ausente",
    };
  }
  try {
    const { result, ms } = await time(async () => {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      return { status: res.status, ok: res.ok };
    });
    if (result.status === 401) {
      return {
        category: "email",
        key: "resend",
        severity: "blocker",
        message: "RESEND_API_KEY inválida (401)",
        durationMs: ms,
      };
    }
    if (!result.ok) {
      return {
        category: "email",
        key: "resend",
        severity: "warning",
        message: `Resend retornou ${result.status}`,
        durationMs: ms,
      };
    }
    return {
      category: "email",
      key: "resend",
      severity: "ok",
      message: "Resend alcançável + key válida",
      durationMs: ms,
    };
  } catch (err) {
    return {
      category: "email",
      key: "resend",
      severity: "warning",
      message: `Resend não alcançável: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkUpstash(): Promise<CheckResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return {
      category: "ratelimit",
      key: "upstash",
      severity: "warning",
      message: "Upstash Redis não configurado — rate limit usa fallback in-memory (não persiste entre invocations em serverless)",
    };
  }
  try {
    const { result, ms } = await time(async () => {
      const res = await fetch(`${url}/ping`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      return { status: res.status, ok: res.ok };
    });
    return {
      category: "ratelimit",
      key: "upstash",
      severity: result.ok ? "ok" : "warning",
      message: result.ok ? "Upstash OK" : `Upstash retornou ${result.status}`,
      durationMs: ms,
    };
  } catch (err) {
    return {
      category: "ratelimit",
      key: "upstash",
      severity: "warning",
      message: `Upstash não alcançável: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkDeals(orgId: string | null): Promise<CheckResult> {
  if (!orgId) {
    return {
      category: "deals",
      key: "approvedContracts",
      severity: "warning",
      message: "Sem org selecionada — não foi possível contar contratos aprovados",
    };
  }
  // Deal não tem orgId direto (escopado via pipeline→org). Contamos contratos
  // aprovados na org como proxy — se existir ≥1, há pelo menos 1 deal aprovado.
  const count = await prisma.contract.count({
    where: {
      status: "aprovado",
      deal: { pipeline: { orgId } },
    },
  });
  return {
    category: "deals",
    key: "approvedContracts",
    severity: count > 0 ? "ok" : "warning",
    message:
      count > 0
        ? `${count} contrato(s) aprovado(s) na org — Bloco 5b (cobrança from Deal) testável`
        : "Nenhum contrato aprovado — Bloco 5b (cobrança from Deal) ficará vazio. Crie 1 deal + contrato + aprovação antes do QA para cobertura completa.",
    meta: { count },
  };
}

/**
 * Roda todos os checks de preflight e retorna relatório estruturado.
 * Não modifica state. Usa libs existentes (pingAsaas, prisma).
 */
export async function runPreflight(orgId: string | null): Promise<PreflightReport> {
  const checks: CheckResult[] = [];

  for (const e of REQUIRED_ENVS) checks.push(envCheck(e, true));
  for (const e of OPTIONAL_ENVS) checks.push(envCheck(e, false));

  checks.push(...(await checkDatabase()));
  checks.push(...(await checkAsaas(orgId)));
  checks.push(await checkResend());
  checks.push(await checkUpstash());
  checks.push(await checkDeals(orgId));

  const blockersCount = checks.filter((c) => c.severity === "blocker").length;
  const warningsCount = checks.filter((c) => c.severity === "warning").length;

  return {
    ok: blockersCount === 0,
    blockersCount,
    warningsCount,
    checks,
    deployment: {
      vercelEnv: process.env.VERCEL_ENV ?? null,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
    generatedAt: new Date().toISOString(),
  };
}
