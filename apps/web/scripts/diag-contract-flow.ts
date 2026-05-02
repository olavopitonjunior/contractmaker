/**
 * Reproduz exatamente o flow de generateContractForDeal pra um contrato existente,
 * SEM o try/catch silencioso. Vai expor o erro real que está bloqueando a
 * população do googleDocId em produção.
 */
// Use: node --env-file=.env --loader ts-node/esm scripts/diag-contract-flow.ts
// OU: npx ts-node ... mas exige env var DATABASE_URL no shell.

import { PrismaClient } from "@prisma/client";
import { isGoogleDocsFeatureEnabled, isOwnerOAuthConfigured } from "../src/lib/google/client";
import { createDocFromTemplate } from "../src/lib/google/docs";
import { flattenForGoogleDoc } from "../src/lib/google/placeholders";

async function main() {
  const prisma = new PrismaClient();

  console.log("Env checks:");
  console.log("  isGoogleDocsFeatureEnabled:", isGoogleDocsFeatureEnabled());
  console.log("  isOwnerOAuthConfigured:", isOwnerOAuthConfigured());

  // Pega o último contrato sem googleDocId pra simular
  const contract = await prisma.contract.findFirst({
    where: { googleDocId: null, template: { engine: "google_docs", googleTemplateDocId: { not: null } } },
    orderBy: { createdAt: "desc" },
    include: { template: true },
  });

  if (!contract) {
    console.log("Nenhum contrato candidato.");
    return;
  }

  console.log(`\nContrato escolhido: ${contract.id} (${contract.template.name})`);
  console.log(`  Template googleTemplateDocId: ${contract.template.googleTemplateDocId}`);

  const data = {
    ...(contract.dataJson as Record<string, unknown>),
    contrato: {
      numero: `${contract.id.slice(-8).toUpperCase()}-v${contract.version}`,
      id: contract.id,
      versao: contract.version,
    },
  };

  console.log("\nflattenForGoogleDoc...");
  const replacements = flattenForGoogleDoc(data);
  console.log(`  ${Object.keys(replacements).length} placeholders gerados`);

  console.log("\ncreateDocFromTemplate (NO catch)...");
  const created = await createDocFromTemplate({
    templateDocId: contract.template.googleTemplateDocId!,
    name: `DIAG-${contract.id} v${contract.version}`,
    replacements,
    dataForLoops: data,
  });
  console.log(`  ✓ Criado: ${created.docId}`);
  console.log(`  URL: ${created.webViewLink}`);

  console.log("\nDeleting test doc...");
  const { google } = await import("googleapis");
  const ownerAuth = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  ownerAuth.setCredentials({ refresh_token: process.env.GOOGLE_OWNER_REFRESH_TOKEN });
  await google.drive({ version: "v3", auth: ownerAuth }).files.delete({ fileId: created.docId });
  console.log("  ✓ deletado");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n✗ ERRO REAL:");
  console.error("  message:", err.message);
  console.error("  code:", err.code);
  console.error("  errors:", err.errors);
  console.error("  stack:", err.stack);
  process.exit(1);
});
