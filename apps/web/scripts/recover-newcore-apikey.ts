/**
 * Recupera apiKey da subconta Asaas órfã rodando localmente — útil quando
 * o endpoint /accessTokens exige whitelist de IPs e o IP da máquina local
 * já está autorizado (mas o Vercel iad1 não).
 *
 * Uso:
 *   cd apps/web
 *   pnpm tsx scripts/recover-newcore-apikey.ts <asaasId>
 *
 * Env vars necessárias (lê de .env.vercel-prod.clean automaticamente):
 *   - ASAAS_API_KEY (master da org-mãe)
 *   - ASAAS_ENV (sandbox|production)
 *
 * Output: apiKey em stdout. Cola no Contractmaker via "Importar com apiKey".
 *
 * NÃO escreve no DB — só obtém a credencial. O import vai pelo endpoint
 * admin /api/admin/accounts/import-with-apikey, que valida + audita.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Parser .env mínimo (sem deps) — lê .env.vercel-prod.clean.
// Suporta linhas KEY=VALUE; ignora comentários e linhas em branco;
// remove aspas duplas/simples do valor; respeita literal '\n' (não
// converte — esse é o ponto do .env.vercel-prod.clean vs .vercel-prod).
function loadEnvFile(filepath: string): void {
  let content: string;
  try {
    content = readFileSync(filepath, "utf8");
  } catch (e) {
    console.error(
      `Falha ao ler ${filepath}:`,
      e instanceof Error ? e.message : e
    );
    process.exit(1);
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const envFile = resolve(process.cwd(), ".env.vercel-prod.clean");
loadEnvFile(envFile);

const asaasId = process.argv[2];
if (!asaasId) {
  console.error("Uso: pnpm tsx scripts/recover-newcore-apikey.ts <asaasId>");
  process.exit(1);
}

const apiKey = process.env.ASAAS_API_KEY;
const env = process.env.ASAAS_ENV ?? "sandbox";
if (!apiKey) {
  console.error("ASAAS_API_KEY ausente em .env.vercel-prod.clean");
  process.exit(1);
}

const baseUrl =
  env === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";

async function main() {
  console.log(`[recover] env=${env} asaasId=${asaasId}`);
  console.log(`[recover] base=${baseUrl}`);

  // 1) Confirma que a subconta existe
  console.log("[recover] 1/3 Buscando subconta...");
  const getRes = await fetch(`${baseUrl}/accounts/${asaasId}`, {
    headers: {
      access_token: apiKey!,
      "Content-Type": "application/json",
    },
  });
  if (!getRes.ok) {
    const errBody = await getRes.text();
    console.error(`[recover] GET /accounts/${asaasId} falhou ${getRes.status}:`);
    console.error(errBody);
    process.exit(1);
  }
  const sub = await getRes.json();
  console.log(
    `[recover]    name=${sub.name} email=${sub.email} walletId=${sub.walletId}`
  );

  // 2) Gera nova apiKey
  console.log("[recover] 2/3 Gerando nova apiKey via /accessTokens...");
  const tokenRes = await fetch(`${baseUrl}/accounts/${asaasId}/accessTokens`, {
    method: "POST",
    headers: {
      access_token: apiKey!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Contractmaker recovery ${new Date().toISOString().slice(0, 10)}`,
    }),
  });
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error(`[recover] POST /accessTokens falhou ${tokenRes.status}:`);
    console.error(errBody);
    console.error(
      "\nSe foi whitelist error: confirme que o IP da máquina onde este script roda está autorizado no painel Asaas (não o IP do Vercel)."
    );
    process.exit(1);
  }
  const tokenResp = await tokenRes.json();
  if (!tokenResp.apiKey) {
    console.error("[recover] Asaas não retornou apiKey:", tokenResp);
    process.exit(1);
  }

  // 3) Valida a apiKey nova chamando /myAccount/status com ela
  console.log("[recover] 3/3 Validando apiKey via /myAccount/status...");
  const statusRes = await fetch(`${baseUrl}/myAccount/status`, {
    headers: {
      access_token: tokenResp.apiKey,
      "Content-Type": "application/json",
    },
  });
  if (!statusRes.ok) {
    console.error(
      `[recover] /myAccount/status falhou ${statusRes.status} — apiKey pode estar inativa`
    );
    console.error(await statusRes.text());
  } else {
    const status = await statusRes.json();
    console.log(
      `[recover]    status: general=${status.general} docs=${status.documentation} commercial=${status.commercialInfo} bank=${status.bankAccountInfo}`
    );
  }

  console.log("\n========== APIKEY (cola no Contractmaker) ==========");
  console.log(`asaasId:  ${asaasId}`);
  console.log(`walletId: ${sub.walletId}`);
  console.log(`apiKey:   ${tokenResp.apiKey}`);
  console.log("====================================================\n");
  console.log(
    'Vá em /settings/pagamentos/contas → "Importar com apiKey" → cole acima.'
  );
}

main().catch((e) => {
  console.error("[recover] crash:", e);
  process.exit(1);
});
