/**
 * Rotaciona a apiKey criptografada de uma AsaasAccount para a chave de produção.
 *
 * Contexto: quando ASAAS_ENV é trocado de "sandbox" para "production" no Vercel,
 * a coluna AsaasAccount.apiKeyEncrypted ainda guarda a chave antiga (sandbox).
 * O guard assertEnvConsistency em src/lib/asaas/client.ts rejeita esse mismatch
 * com AsaasConfigError code=ENV_MISMATCH, derrubando /charges/nova e /statement.
 *
 * Uso:
 *   ASAAS_API_KEY_NEW='$aact_prod_xxx...' \
 *   DATABASE_URL='postgres://...' \
 *   MASTER_ENCRYPTION_KEY='<base64 32 bytes>' \
 *   npx tsx scripts/rotate-asaas-key.ts --org-id <orgId> [--dry-run]
 *
 *   ou
 *
 *   npx tsx scripts/rotate-asaas-key.ts --wallet-id <walletId> [--dry-run]
 *
 * IMPORTANTE: passe a chave nova via env ASAAS_API_KEY_NEW (com aspas SIMPLES no
 * shell — caracteres `$` são interpretados pelo bash em aspas duplas).
 *
 * O script:
 *   1. Decripta a apiKey atual (pra log de prefixo)
 *   2. Valida o prefixo da nova chave bate com ASAAS_ENV (production → $aact_prod)
 *   3. Encripta a nova chave (AES-256-GCM)
 *   4. UPDATE AsaasAccount SET apiKeyEncrypted, apiKeyIvBase64, apiKeyTagBase64
 *   5. Faz uma chamada GET /v3/myAccount como smoke test
 */

import { PrismaClient } from "@prisma/client";
import { encryptSecret, decryptSecret } from "../src/lib/security/crypto";

interface Args {
  orgId?: string;
  walletId?: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--org-id") out.orgId = args[++i];
    else if (a === "--wallet-id") out.walletId = args[++i];
    else {
      console.error(`Argumento desconhecido: ${a}`);
      process.exit(1);
    }
  }
  if (!out.orgId && !out.walletId) {
    console.error("Use --org-id <id> ou --wallet-id <wid>");
    process.exit(1);
  }
  return out;
}

function maskKey(key: string): string {
  if (key.length < 16) return "***";
  return `${key.slice(0, 12)}…${key.slice(-4)}`;
}

async function smokeTest(apiKey: string, env: "sandbox" | "production"): Promise<void> {
  const baseUrl =
    env === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const res = await fetch(`${baseUrl}/myAccount`, {
    headers: { access_token: apiKey, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Smoke test falhou: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  console.log(
    `  ↳ /v3/myAccount OK · email=${json.email ?? "?"} · walletId=${json.walletId ?? "?"} · personType=${json.personType ?? "?"}`
  );
}

async function main() {
  const { orgId, walletId, dryRun } = parseArgs();

  const newKey = process.env.ASAAS_API_KEY_NEW;
  if (!newKey) {
    console.error("ASAAS_API_KEY_NEW ausente no env. Passe a chave de produção.");
    process.exit(1);
  }
  const env = (process.env.ASAAS_ENV ?? "sandbox") as "sandbox" | "production";
  if (env !== "sandbox" && env !== "production") {
    console.error(`ASAAS_ENV inválido: ${env}`);
    process.exit(1);
  }

  // Sanity: prefixo da nova chave bate com ASAAS_ENV
  const looksSandbox =
    newKey.startsWith("$aact_YT") || newKey.startsWith("$aact_hmlg");
  const looksProd = newKey.startsWith("$aact_prod");
  if (env === "production" && !looksProd) {
    console.error(
      `Prefixo inválido: ASAAS_ENV=production exige chave começando com $aact_prod (recebeu ${maskKey(newKey)}).`
    );
    process.exit(1);
  }
  if (env === "sandbox" && !looksSandbox) {
    console.error(
      `Prefixo inválido: ASAAS_ENV=sandbox exige $aact_YT… ou $aact_hmlg… (recebeu ${maskKey(newKey)}).`
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const account = await prisma.asaasAccount.findFirst({
      where: orgId ? { orgId } : { walletId },
    });
    if (!account) {
      console.error(
        `AsaasAccount não encontrada para ${orgId ? `orgId=${orgId}` : `walletId=${walletId}`}`
      );
      process.exit(1);
    }

    const oldKey = decryptSecret({
      ciphertext: account.apiKeyEncrypted,
      iv: account.apiKeyIvBase64,
      tag: account.apiKeyTagBase64,
    });

    console.log("AsaasAccount alvo:");
    console.log(`  orgId   : ${account.orgId}`);
    console.log(`  walletId: ${account.walletId}`);
    console.log(`  status  : ${account.status}`);
    console.log(`  oldKey  : ${maskKey(oldKey)}`);
    console.log(`  newKey  : ${maskKey(newKey)}`);
    console.log(`  ASAAS_ENV: ${env}`);

    if (oldKey === newKey) {
      console.log("Chave nova idêntica à atual. Nada a fazer.");
      return;
    }

    console.log("\n[1/2] Smoke test contra Asaas com a chave NOVA…");
    await smokeTest(newKey, env);

    if (dryRun) {
      console.log("\n--dry-run: pulando UPDATE.");
      return;
    }

    console.log("\n[2/2] Encriptando + UPDATE AsaasAccount…");
    const enc = encryptSecret(newKey);
    await prisma.asaasAccount.update({
      where: { id: account.id },
      data: {
        apiKeyEncrypted: enc.ciphertext,
        apiKeyIvBase64: enc.iv,
        apiKeyTagBase64: enc.tag,
      },
    });
    console.log("  ↳ UPDATE OK.");

    console.log("\nRotação concluída. Recomendado: testar POST /api/financeiro/charges/nova logo em seguida.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
