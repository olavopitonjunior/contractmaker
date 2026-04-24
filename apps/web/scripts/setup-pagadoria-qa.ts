/**
 * Setup automatizado para QA do módulo Pagadoria.
 *
 * Executa em sequência:
 *   1. Cadastra webhook Asaas apontando para a URL do Contractmaker
 *      (idempotente — recria se já existe com mesma URL)
 *   2. Aprova a subconta sandbox do admin (pula aprovação manual no painel)
 *   3. Verifica /v3/myAccount/status do subaccount — tudo deve estar APPROVED
 *
 * Uso:
 *   npx tsx scripts/setup-pagadoria-qa.ts \
 *     --app-url https://seu-dominio.com \
 *     --email admin@contractmaker.com
 *
 *   # Flags opcionais
 *     --webhook-token <hex>  # se ausente, usa ASAAS_WEBHOOK_TOKEN do env
 *     --skip-approve         # só cadastra webhook, pula approve
 *     --skip-webhook         # só aprova conta, pula webhook
 *     --dry-run              # mostra o que faria, sem executar
 *
 * Env obrigatórias:
 *   DATABASE_URL, ASAAS_API_KEY, ASAAS_ENV=sandbox, MASTER_ENCRYPTION_KEY
 *   ASAAS_WEBHOOK_TOKEN (se --webhook-token ausente)
 *
 * Segurança:
 *   - Refusa rodar se ASAAS_ENV=production
 *   - Decripta apiKey da subconta localmente (MASTER_ENCRYPTION_KEY)
 *   - Webhook authToken é o mesmo que o Contractmaker valida em
 *     /api/webhooks/asaas → SEMPRE passar o mesmo valor de ASAAS_WEBHOOK_TOKEN
 */

import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/security/crypto";
import { approveSandboxAccount } from "../src/lib/asaas/sandbox";
import {
  upsertWebhookByUrl,
  DEFAULT_CONTRACTMAKER_EVENTS,
  type WebhookConfig,
} from "../src/lib/asaas/webhooks";
import { asaasFetch } from "../src/lib/asaas/client";

const prisma = new PrismaClient();

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  if (process.env.ASAAS_ENV === "production") {
    console.error("❌ ASAAS_ENV=production — este script é sandbox-only. Abortando.");
    process.exit(1);
  }

  const appUrl = arg("--app-url");
  const email = arg("--email") ?? "admin@contractmaker.com";
  const webhookToken = arg("--webhook-token") ?? process.env.ASAAS_WEBHOOK_TOKEN;
  const skipApprove = flag("--skip-approve");
  const skipWebhook = flag("--skip-webhook");
  const dryRun = flag("--dry-run");

  if (!appUrl) {
    console.error("❌ --app-url é obrigatório (ex: https://contractmaker.com.br)");
    process.exit(1);
  }
  if (!skipWebhook && !webhookToken) {
    console.error("❌ --webhook-token ou ASAAS_WEBHOOK_TOKEN do env é obrigatório");
    process.exit(1);
  }

  console.log(`\n🔧 Setup Pagadoria QA`);
  console.log(`   app-url: ${appUrl}`);
  console.log(`   email:   ${email}`);
  console.log(`   env:     ${process.env.ASAAS_ENV ?? "sandbox"}`);
  console.log(`   dryRun:  ${dryRun}\n`);

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      orgMemberships: { include: { org: { include: { asaasAccount: true } } } },
    },
  });
  if (!user) {
    console.error(`❌ Usuário ${email} não encontrado`);
    process.exit(1);
  }
  const membership = user.orgMemberships[0];
  if (!membership) {
    console.error(`❌ Usuário ${email} não tem org`);
    process.exit(1);
  }
  const asaasAccount = membership.org.asaasAccount;
  if (!asaasAccount) {
    console.error(
      `❌ Org ${membership.org.id} não tem AsaasAccount. Faça KYC primeiro em /financeiro/onboarding`
    );
    process.exit(1);
  }

  console.log(`✓ Org: ${membership.org.name} (${membership.org.id})`);
  console.log(`✓ AsaasAccount.status atual: ${asaasAccount.status}`);

  const subApiKey = decryptSecret({
    ciphertext: asaasAccount.apiKeyEncrypted,
    iv: asaasAccount.apiKeyIvBase64,
    tag: asaasAccount.apiKeyTagBase64,
  });

  // 1) Cadastra webhook (usa master key — webhook é na conta master)
  if (!skipWebhook) {
    const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/asaas`;
    const config: WebhookConfig = {
      name: "Contractmaker Pagadoria (QA)",
      url: webhookUrl,
      email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: webhookToken!,
      sendType: "SEQUENTIALLY",
      events: DEFAULT_CONTRACTMAKER_EVENTS,
    };

    console.log(`\n📡 Webhook`);
    console.log(`   url: ${webhookUrl}`);
    console.log(`   events: ${config.events.length}`);
    if (dryRun) {
      console.log(`   [dry-run] cadastraria via POST /v3/webhooks`);
    } else {
      try {
        const result = await upsertWebhookByUrl(config);
        console.log(
          `   ✓ ${result.created ? "Criado" : result.replaced ? "Recriado (substituiu existente)" : "OK"} — id ${result.webhook.id}`
        );
      } catch (err) {
        console.error(`   ❌ Falha ao cadastrar webhook: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
  }

  // 2) Aprova subconta sandbox (usa subaccount apiKey)
  if (!skipApprove) {
    console.log(`\n🏦 Aprovação sandbox da subconta`);
    if (asaasAccount.status === "APPROVED") {
      console.log(`   ℹ Subconta já APPROVED no DB. Reaprovando via sandbox para garantir sync.`);
    }
    if (dryRun) {
      console.log(`   [dry-run] chamaria POST /v3/sandbox/myAccount/approve com subaccount apiKey`);
    } else {
      try {
        const approval = await approveSandboxAccount(subApiKey);
        console.log(`   ✓ Aprovado — general=${approval.general} docs=${approval.documentation} commercial=${approval.commercialInfo} bank=${approval.bankAccountInfo}`);

        // Sync no DB local
        await prisma.asaasAccount.update({
          where: { id: asaasAccount.id },
          data: {
            status: "APPROVED",
            approvedAt: new Date(),
            generalStatus: approval.general,
            documentationStatus: approval.documentation,
            commercialInfoStatus: approval.commercialInfo,
            bankAccountInfoStatus: approval.bankAccountInfo,
            lastStatusCheckAt: new Date(),
          },
        });
        console.log(`   ✓ DB local atualizado (AsaasAccount.status = APPROVED)`);
      } catch (err) {
        console.error(`   ❌ Falha na aprovação: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
  }

  // 3) Health check final via /v3/myAccount/status
  if (!skipApprove && !dryRun) {
    console.log(`\n🩺 Health check`);
    try {
      const status = await asaasFetch<{
        commercialInfo: string;
        bankAccountInfo: string;
        documentation: string;
        general: string;
      }>("/myAccount/status", { apiKey: subApiKey, retry: false });
      const allApproved =
        status.commercialInfo === "APPROVED" &&
        status.bankAccountInfo === "APPROVED" &&
        status.documentation === "APPROVED" &&
        status.general === "APPROVED";
      console.log(`   ${allApproved ? "✓" : "⚠"} Status: general=${status.general} docs=${status.documentation} commercial=${status.commercialInfo} bank=${status.bankAccountInfo}`);
      if (!allApproved) {
        console.log(`   ⚠ Algum status não APPROVED — pode requerer ação manual no painel`);
      }
    } catch (err) {
      console.error(`   ⚠ /myAccount/status falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n✅ Setup concluído. Chame GET /api/admin/preflight-qa para validar e começar o QA.\n`);
}

main()
  .catch((err) => {
    console.error("❌ Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
