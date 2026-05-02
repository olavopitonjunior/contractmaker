/**
 * Verifica se o domínio `imobpro.ia.br` está pronto para receber Drive
 * webhooks (push notifications). Falha clara → instruções para resolver.
 *
 * Uso:
 *   npx ts-node scripts/verify-google-domain.ts
 *
 * Pré-requisito de prod:
 *   1. Verificar o domínio em https://search.google.com/search-console
 *      (HTML tag, DNS TXT, ou file upload — qualquer método)
 *   2. Em https://console.cloud.google.com/apis/credentials/domainverification
 *      (mesma conta/projeto), confirmar que o domínio aparece como verificado
 *   3. Esse script tenta criar um watch de 1 minuto pra validar end-to-end
 */

import fs from "fs";
import path from "path";
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*'?([^']*)'?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

import { watchFile, unwatchChannel } from "../src/lib/google/watch";
import { getDriveFolderId, getOwnerDriveClient } from "../src/lib/google/client";

// Permite override por arg --url=https://prod.example.com (NEXTAUTH_URL local
// é localhost, mas Drive webhook exige HTTPS público).
const URL_ARG = process.argv.find((a) => a.startsWith("--url="))?.slice(6);
const DOMAIN = URL_ARG || "https://imobpro.ia.br";

async function main() {
  console.log(`Verificando suporte a Drive webhooks para ${DOMAIN}…\n`);

  // 1. Confirma que o GOOGLE_WATCH_TOKEN está setado
  if (!process.env.GOOGLE_WATCH_TOKEN) {
    console.error("✗ GOOGLE_WATCH_TOKEN ausente. Setar no .env.");
    process.exit(1);
  }
  console.log("✓ GOOGLE_WATCH_TOKEN setado");

  // 2. Cria um arquivo descartável pra testar
  const folderId = getDriveFolderId();
  if (!folderId) {
    console.error("✗ GOOGLE_DRIVE_FOLDER_ID ausente.");
    process.exit(1);
  }
  console.log(`✓ Drive folder: ${folderId}`);

  const drive = getOwnerDriveClient();
  console.log("\nCriando arquivo de teste (owner OAuth)…");
  const testFile = await drive.files.create({
    requestBody: {
      name: "DOMAIN VERIFY TEST - delete me",
      mimeType: "application/vnd.google-apps.document",
      parents: [folderId],
    },
    fields: "id",
  });
  const fileId = testFile.data.id!;
  console.log(`  fileId: ${fileId}`);

  // 3. Tenta watch
  const webhookUrl = `${DOMAIN.replace(/\/$/, "")}/api/webhooks/google-drive`;
  console.log(`\nTentando watch em ${webhookUrl}…`);
  let channelId: string | null = null;
  let resourceId: string | null = null;
  try {
    const watch = await watchFile({
      fileId,
      webhookUrl,
      token: process.env.GOOGLE_WATCH_TOKEN!,
      ttlSeconds: 60, // 1 minuto, vai expirar logo
    });
    channelId = watch.channelId;
    resourceId = watch.resourceId;
    console.log(`✓ Watch criado: channelId=${channelId}`);
    console.log(`  Expira em: ${new Date(watch.expiration).toISOString()}`);
  } catch (err: any) {
    const reason = err?.errors?.[0]?.reason || err?.message || String(err);
    console.error(`\n✗ Watch FALHOU: ${reason}`);
    if (reason.includes("webhookUrlNotHttps") || reason.includes("not whitelisted")) {
      console.error(`
Diagnóstico: Google rejeita o webhook URL porque o domínio não está verificado.

Como resolver:
  1. Abrir https://search.google.com/search-console/welcome
  2. "Add property" → URL prefix → "${DOMAIN}"
  3. Escolher um método de verificação (DNS TXT é o mais robusto)
     - Adicionar TXT record no registro.br: google-site-verification=<token>
  4. Aguardar propagação (alguns minutos a 24h)
  5. Voltar e clicar "Verify"
  6. Em https://console.cloud.google.com/apis/credentials/domainverification
     confirmar que o domínio aparece marcado como verificado para esta conta
     e este projeto Cloud (gen-lang-client-0443337417)
  7. Re-rodar este script

Sem isso, o watchFile() em contract-generation.ts continua falhando
silenciosamente — contratos novos são criados mas sem webhook ativo,
e ContractChangeLog não recebe edições do Drive.
`);
    } else {
      console.error("Detalhes:", err);
    }
    // Cleanup
    await drive.files.delete({ fileId }).catch(() => null);
    process.exit(1);
  }

  // 4. Cleanup
  console.log("\nLimpando…");
  if (channelId && resourceId) {
    await unwatchChannel(channelId, resourceId).catch((e) =>
      console.warn("  unwatch falhou (ok se já expirou):", e.message)
    );
  }
  await drive.files.delete({ fileId });
  console.log("✓ Test file deletado");

  console.log("\n✓ Domínio pronto para Drive webhooks.");
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exit(1);
});
