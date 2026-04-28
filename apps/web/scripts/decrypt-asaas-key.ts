/**
 * One-shot helper: imprime no stdout a apiKey decriptada de uma AsaasAccount.
 *
 * Uso: npx tsx scripts/decrypt-asaas-key.ts --org-id <orgId>
 *
 * AVISO: imprime credencial em stdout — só usar em pipe (`| vercel env add ...`),
 * nunca em terminal interativo onde o output pode ficar em scrollback.
 */
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/security/crypto";

async function main() {
  const idx = process.argv.indexOf("--org-id");
  const orgId = idx >= 0 ? process.argv[idx + 1] : null;
  if (!orgId) {
    console.error("Use --org-id <id>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const a = await prisma.asaasAccount.findFirst({ where: { orgId } });
    if (!a) {
      console.error(`AsaasAccount não encontrada para orgId=${orgId}`);
      process.exit(1);
    }
    const key = decryptSecret({
      ciphertext: a.apiKeyEncrypted,
      iv: a.apiKeyIvBase64,
      tag: a.apiKeyTagBase64,
    });
    process.stdout.write(key);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
