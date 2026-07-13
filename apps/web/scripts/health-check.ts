/**
 * Health check de todas as integrações do Contractmaker.
 *
 * Roda 14 probes em paralelo, mede latência de cada um, e imprime tabela
 * final com PASS / WARN / FAIL.
 *
 * Custo: ~$0.0005 (1 Anthropic Haiku + 1 Gemini Flash + 1 Voyage embed,
 *                   todos com payload mínimo).
 *
 * Uso:
 *   npx tsx scripts/health-check.ts
 *   npx tsx scripts/health-check.ts --verbose
 *
 * Exit code 1 se houver FAIL (warn não falha).
 */
import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { Redis } from "@upstash/redis";
import { decryptSecret } from "../src/lib/security/crypto";

const verbose = process.argv.includes("--verbose");

type CheckStatus = "pass" | "warn" | "fail" | "info";
interface CheckResult {
  name: string;
  status: CheckStatus;
  latencyMs?: number;
  detail: string;
  alert?: string;
}

const TIMEOUT_MS = 20_000;

function timed<T>(promise: Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  return promise.then((value) => ({ value, ms: Date.now() - t0 }));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout após ${ms}ms`)), ms)
    ),
  ]);
}

async function checkDatabase(): Promise<CheckResult> {
  const prisma = new PrismaClient();
  try {
    const { ms } = await timed(prisma.$queryRawUnsafe<unknown[]>("SELECT 1"));
    const orgs = await prisma.organization.count();
    const users = await prisma.user.count();
    const dbHost = process.env.DATABASE_URL?.match(/@([^.]+)/)?.[1] ?? "unknown";
    return {
      name: "Database (Neon)",
      status: "pass",
      latencyMs: ms,
      detail: `${dbHost} · ${orgs} org · ${users} users`,
    };
  } catch (e) {
    return {
      name: "Database (Neon)",
      status: "fail",
      detail: (e as Error).message,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function checkAnthropic(): Promise<CheckResult> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { name: "Anthropic Claude", status: "fail", detail: "ANTHROPIC_API_KEY ausente" };
    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_PASSIVE_MODEL || "claude-haiku-4-5-20251001";
    const { value, ms } = await timed(
      withTimeout(
        client.messages.create({
          model,
          max_tokens: 5,
          messages: [{ role: "user", content: "ping" }],
        }),
        TIMEOUT_MS,
        "Anthropic"
      )
    );
    const text = value.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim()
      .slice(0, 30);
    return {
      name: "Anthropic Claude",
      status: "pass",
      latencyMs: ms,
      detail: `${model} · ${value.usage.input_tokens}+${value.usage.output_tokens} tok · "${text}"`,
    };
  } catch (e) {
    return { name: "Anthropic Claude", status: "fail", detail: (e as Error).message };
  }
}

async function checkGemini(): Promise<CheckResult> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { name: "Google Gemini (OCR)", status: "fail", detail: "GEMINI_API_KEY ausente" };
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
    const { value, ms } = await timed(
      withTimeout(
        ai.models.generateContent({
          model,
          contents: "Reply with one word: pong",
        }),
        TIMEOUT_MS,
        "Gemini"
      )
    );
    const text = (value.text ?? "").trim().slice(0, 30);
    return {
      name: "Google Gemini (OCR)",
      status: "pass",
      latencyMs: ms,
      detail: `${model} · "${text}"`,
    };
  } catch (e) {
    return { name: "Google Gemini (OCR)", status: "fail", detail: (e as Error).message };
  }
}

async function checkVoyage(): Promise<CheckResult> {
  try {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey)
      return {
        name: "Voyage law-2 (embeddings)",
        status: "warn",
        detail: "VOYAGE_API_KEY ausente — RAG cai em fallback ILIKE",
      };
    const t0 = Date.now();
    const res = await withTimeout(
      fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: ["ping"],
          model: process.env.VOYAGE_EMBED_MODEL || "voyage-law-2",
          input_type: "query",
        }),
      }),
      TIMEOUT_MS,
      "Voyage"
    );
    const ms = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text();
      return {
        name: "Voyage law-2 (embeddings)",
        status: "fail",
        latencyMs: ms,
        detail: `HTTP ${res.status} ${txt.slice(0, 100)}`,
      };
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    const dim = json.data[0]?.embedding.length;
    return {
      name: "Voyage law-2 (embeddings)",
      status: dim === 1024 ? "pass" : "warn",
      latencyMs: ms,
      detail: `dim=${dim} (esperado 1024)`,
    };
  } catch (e) {
    return { name: "Voyage law-2 (embeddings)", status: "fail", detail: (e as Error).message };
  }
}

async function asaasFetchProbe(apiKey: string, baseUrl: string, label: string): Promise<CheckResult> {
  try {
    const t0 = Date.now();
    const res = await withTimeout(
      fetch(`${baseUrl}/customers?limit=1`, {
        headers: {
          access_token: apiKey,
          Accept: "application/json",
          "User-Agent": "Contractmaker/1.0 (health-check)",
        },
      }),
      TIMEOUT_MS,
      `Asaas ${label}`
    );
    const ms = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text();
      return {
        name: `Asaas ${label}`,
        status: "fail",
        latencyMs: ms,
        detail: `HTTP ${res.status} ${txt.slice(0, 120)}`,
      };
    }
    const json = (await res.json()) as { totalCount?: number };
    return {
      name: `Asaas ${label}`,
      status: "pass",
      latencyMs: ms,
      detail: `auth ok · customers=${json.totalCount ?? "?"}`,
    };
  } catch (e) {
    return { name: `Asaas ${label}`, status: "fail", detail: (e as Error).message };
  }
}

async function checkAsaasSandbox(): Promise<CheckResult> {
  const key = process.env.ASAAS_API_KEY;
  if (!key) return { name: "Asaas sandbox", status: "warn", detail: "ASAAS_API_KEY ausente" };
  if (!key.startsWith("$aact_hmlg") && !key.startsWith("$aact_YT")) {
    return {
      name: "Asaas sandbox",
      status: "info",
      detail: "ASAAS_API_KEY não parece sandbox (skip)",
    };
  }
  return asaasFetchProbe(key, "https://sandbox.asaas.com/api/v3", "sandbox");
}

async function checkAsaasProduction(): Promise<CheckResult> {
  const prisma = new PrismaClient();
  try {
    const account = await prisma.asaasAccount.findFirst();
    if (!account) {
      return { name: "Asaas produção", status: "warn", detail: "AsaasAccount não existe no banco" };
    }
    if (!process.env.MASTER_ENCRYPTION_KEY) {
      return { name: "Asaas produção", status: "fail", detail: "MASTER_ENCRYPTION_KEY ausente — não dá pra decifrar apiKey" };
    }
    const apiKey = decryptSecret({
      ciphertext: account.apiKeyEncrypted,
      iv: account.apiKeyIvBase64,
      tag: account.apiKeyTagBase64,
    });
    const isProd = apiKey.startsWith("$aact_prod") || (!apiKey.startsWith("$aact_hmlg") && !apiKey.startsWith("$aact_YT"));
    const baseUrl = isProd ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/api/v3";
    const result = await asaasFetchProbe(apiKey, baseUrl, "produção");
    if (result.status === "pass") {
      result.detail = `${result.detail} · wallet=${account.walletId.slice(0, 12)}... · status=${account.generalStatus ?? account.status}`;
      if (!isProd) result.alert = "AsaasAccount.apiKey ainda parece SANDBOX — rotacionar pra produção antes de uso real";
    }
    return result;
  } catch (e) {
    return { name: "Asaas produção", status: "fail", detail: (e as Error).message };
  } finally {
    await prisma.$disconnect();
  }
}

async function checkClicksign(): Promise<CheckResult> {
  const token = process.env.CLICKSIGN_API_TOKEN;
  if (!token) {
    return {
      name: "Clicksign (assinatura)",
      status: "warn",
      detail: "CLICKSIGN_API_TOKEN ausente — assinatura eletrônica indisponível",
    };
  }
  try {
    const baseUrl = process.env.CLICKSIGN_API_BASE_URL || "https://app.clicksign.com";
    const t0 = Date.now();
    const res = await withTimeout(
      fetch(`${baseUrl}/api/v3/envelopes?per_page=1&access_token=${encodeURIComponent(token)}`, {
        headers: { Accept: "application/vnd.api+json" },
      }),
      TIMEOUT_MS,
      "Clicksign"
    );
    const ms = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text();
      return { name: "Clicksign (assinatura)", status: "fail", latencyMs: ms, detail: `HTTP ${res.status} ${txt.slice(0, 100)}` };
    }
    const json = (await res.json()) as { meta?: { total?: number } };
    return {
      name: "Clicksign (assinatura)",
      status: "pass",
      latencyMs: ms,
      detail: `auth ok · envelopes total=${json.meta?.total ?? "?"}`,
    };
  } catch (e) {
    return { name: "Clicksign (assinatura)", status: "fail", detail: (e as Error).message };
  }
}

async function checkGoogleDriveSA(): Promise<CheckResult> {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) return { name: "Google Drive (SA)", status: "fail", detail: "GOOGLE_SERVICE_ACCOUNT_JSON ausente" };
    const { google } = await import("googleapis");
    const creds = JSON.parse(raw.trim()) as { client_email: string; private_key: string };
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({ version: "v3", auth });
    const t0 = Date.now();
    const res = await withTimeout(
      drive.about.get({ fields: "user(emailAddress),storageQuota(limit,usage)" }),
      TIMEOUT_MS,
      "Drive SA"
    );
    const ms = Date.now() - t0;
    const email = res.data.user?.emailAddress;
    const used = res.data.storageQuota?.usage;
    const limit = res.data.storageQuota?.limit;
    return {
      name: "Google Drive (SA)",
      status: "pass",
      latencyMs: ms,
      detail: `${email} · storage=${used}/${limit ?? "∞"}`,
    };
  } catch (e) {
    return { name: "Google Drive (SA)", status: "fail", detail: (e as Error).message };
  }
}

async function checkGoogleOwnerOAuth(): Promise<CheckResult> {
  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    const refreshToken = process.env.GOOGLE_OWNER_REFRESH_TOKEN?.trim();
    if (!clientId || !clientSecret || !refreshToken) {
      return {
        name: "Google Owner OAuth",
        status: "fail",
        detail: "GOOGLE_OAUTH_CLIENT_ID/SECRET/GOOGLE_OWNER_REFRESH_TOKEN faltando",
      };
    }
    const { google } = await import("googleapis");
    const auth = new google.auth.OAuth2({ clientId, clientSecret });
    auth.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: "v3", auth });
    const t0 = Date.now();
    const res = await withTimeout(
      drive.about.get({ fields: "user(emailAddress)" }),
      TIMEOUT_MS,
      "Drive Owner"
    );
    const ms = Date.now() - t0;
    return {
      name: "Google Owner OAuth",
      status: "pass",
      latencyMs: ms,
      detail: `${res.data.user?.emailAddress} (refresh OK)`,
    };
  } catch (e) {
    return { name: "Google Owner OAuth", status: "fail", detail: (e as Error).message };
  }
}

async function checkVercelBlob(): Promise<CheckResult> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return {
      name: "Vercel Blob",
      status: "warn",
      detail: "BLOB_READ_WRITE_TOKEN ausente local (prod usa Vercel env)",
    };
  }
  try {
    const { list } = await import("@vercel/blob");
    const t0 = Date.now();
    const res = await withTimeout(list({ limit: 1, token }), TIMEOUT_MS, "Blob");
    const ms = Date.now() - t0;
    return {
      name: "Vercel Blob",
      status: "pass",
      latencyMs: ms,
      detail: `${res.blobs.length} blob(s) listed`,
    };
  } catch (e) {
    return { name: "Vercel Blob", status: "fail", detail: (e as Error).message };
  }
}

async function checkUpstash(): Promise<CheckResult> {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token)
      return { name: "Upstash Redis", status: "warn", detail: "UPSTASH_REDIS_REST_URL/TOKEN ausentes" };
    const redis = new Redis({ url, token });
    const t0 = Date.now();
    const res = await withTimeout(redis.ping(), TIMEOUT_MS, "Upstash");
    const ms = Date.now() - t0;
    return {
      name: "Upstash Redis",
      status: res === "PONG" ? "pass" : "warn",
      latencyMs: ms,
      detail: String(res),
    };
  } catch (e) {
    return { name: "Upstash Redis", status: "fail", detail: (e as Error).message };
  }
}

/** Roteia pro check do provider ativo (SMTP em produção; Resend é legado). */
async function checkEmail(): Promise<CheckResult> {
  const provider = process.env.EMAIL_PROVIDER ?? "resend";
  if (provider !== "smtp") return checkResend();

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return { name: "SMTP (email)", status: "fail", detail: "SMTP_HOST/SMTP_USER/SMTP_PASS ausentes" };
  }
  try {
    const t0 = Date.now();
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT ?? 587);
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: { user, pass },
      connectionTimeout: TIMEOUT_MS,
    });
    // verify() = handshake + auth, sem enviar e-mail nenhum.
    await transporter.verify();
    transporter.close();
    return { name: "SMTP (email)", status: "ok", detail: `${host}:${port}`, ms: Date.now() - t0 };
  } catch (e) {
    return { name: "SMTP (email)", status: "fail", detail: (e as Error).message };
  }
}

async function checkResend(): Promise<CheckResult> {
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { name: "Resend (email)", status: "fail", detail: "RESEND_API_KEY ausente" };
    const t0 = Date.now();
    const res = await withTimeout(
      fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
      }),
      TIMEOUT_MS,
      "Resend"
    );
    const ms = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text();
      return { name: "Resend (email)", status: "fail", latencyMs: ms, detail: `HTTP ${res.status} ${txt.slice(0, 100)}` };
    }
    const json = (await res.json()) as { data?: Array<{ name: string; status: string }> };
    const verified = (json.data ?? []).filter((d) => d.status === "verified");
    const from = process.env.EMAIL_FROM ?? "?";
    const detail = `${verified.length} verified · FROM=${from}`;
    const isSandboxFrom = from.endsWith("@resend.dev");
    return {
      name: "Resend (email)",
      status: isSandboxFrom ? "warn" : "pass",
      latencyMs: ms,
      detail,
      alert: isSandboxFrom
        ? "EMAIL_FROM=onboarding@resend.dev é sandbox — só envia pro dono. Trocar por domínio verificado em prod."
        : undefined,
    };
  } catch (e) {
    return { name: "Resend (email)", status: "fail", detail: (e as Error).message };
  }
}

async function checkInfosimples(): Promise<CheckResult> {
  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token)
    return {
      name: "Infosimples (certidões)",
      status: "warn",
      detail: "INFOSIMPLES_TOKEN ausente — diligência indisponível",
    };
  return {
    name: "Infosimples (certidões)",
    status: "info",
    detail: `token configurado (len=${token.length}) · sem probe (cobrado por chamada)`,
  };
}

async function checkSecrets(): Promise<CheckResult> {
  const required = [
    "AUTH_SECRET",
    "MASTER_ENCRYPTION_KEY",
    "CHALLENGE_TOKEN_SECRET",
    "TRUSTED_DEVICE_SECRET",
    "SUDO_TOKEN_SECRET",
    "ASAAS_WEBHOOK_TOKEN",
  ];
  const present = required.filter((k) => process.env[k] && process.env[k]!.length > 0);
  const missing = required.filter((k) => !process.env[k]);

  const alerts: string[] = [];
  if (process.env.AUTH_SECRET?.includes("change-in-production")) {
    alerts.push("AUTH_SECRET é placeholder literal — trocar por valor forte em prod");
  }
  if (process.env.NEXTAUTH_URL?.startsWith("http://localhost")) {
    alerts.push(`NEXTAUTH_URL=${process.env.NEXTAUTH_URL} (dev) — prod precisa ser https://imobpro.ia.br`);
  }
  if (process.env.ASAAS_ENV !== "production") {
    alerts.push(`ASAAS_ENV=${process.env.ASAAS_ENV} (dev) — prod precisa ser "production"`);
  }
  return {
    name: "Secrets / config",
    status: missing.length === 0 && alerts.length === 0 ? "pass" : missing.length > 0 ? "fail" : "warn",
    detail: `${present.length}/${required.length} secrets · ${alerts.length} alerta(s)${missing.length ? ` · faltando: ${missing.join(", ")}` : ""}`,
    alert: alerts.length > 0 ? alerts.join(" | ") : undefined,
  };
}

const CHECKS: Array<() => Promise<CheckResult>> = [
  checkDatabase,
  checkAnthropic,
  checkGemini,
  checkVoyage,
  checkAsaasSandbox,
  checkAsaasProduction,
  checkClicksign,
  checkGoogleDriveSA,
  checkGoogleOwnerOAuth,
  checkVercelBlob,
  checkUpstash,
  checkEmail,
  checkInfosimples,
  checkSecrets,
];

const ICON: Record<CheckStatus, string> = {
  pass: "[ OK ]",
  warn: "[WARN]",
  fail: "[FAIL]",
  info: "[ -- ]",
};

async function main() {
  console.log("================================================");
  console.log("HEALTH CHECK — Contractmaker");
  const dbHost = process.env.DATABASE_URL?.match(/@([^.]+)/)?.[1] ?? "?";
  console.log(`DB host:  ${dbHost}`);
  console.log(`Asaas env: ${process.env.ASAAS_ENV ?? "?"}`);
  console.log(`NEXTAUTH_URL: ${process.env.NEXTAUTH_URL ?? "?"}`);
  console.log("================================================\n");

  const results = await Promise.all(CHECKS.map((c) => c().catch((e): CheckResult => ({
    name: c.name,
    status: "fail",
    detail: (e as Error).message,
  }))));

  let pass = 0, warn = 0, fail = 0;
  const alerts: string[] = [];
  for (const r of results) {
    const lat = r.latencyMs ? `${r.latencyMs}ms`.padStart(7) : "    -- ";
    console.log(`${ICON[r.status]} ${r.name.padEnd(28)} ${lat}  ${r.detail}`);
    if (verbose && r.alert) console.log(`         └─ ${r.alert}`);
    if (r.status === "pass") pass++;
    else if (r.status === "warn") warn++;
    else if (r.status === "fail") fail++;
    if (r.alert) alerts.push(`${r.name}: ${r.alert}`);
  }

  console.log("\n--------------------------------------------------------------");
  console.log(`PASS: ${pass}  WARN: ${warn}  FAIL: ${fail}  TOTAL: ${results.length}`);
  if (alerts.length) {
    console.log("\nALERTAS:");
    alerts.forEach((a) => console.log(`  · ${a}`));
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[health-check] ERRO FATAL:", err);
  process.exit(1);
});
