/**
 * QA ao vivo (ClickSign PRODUÇÃO — R$ 1,50/signer é aceito em QA, ver CLAUDE.md):
 * valida que dá pra INCLUIR signatário em envelope `running` sem cancelar.
 *
 * Fluxo: cria envelope QA → doc PDF mínimo → signer A + requirements (draft) →
 * ativa → signer B + requirements via bulk_requirements (o ponto crítico) →
 * notifica B → lista requirements pra conferir → CANCELA o envelope (limpeza,
 * ninguém precisa assinar).
 *
 * Uso: npx tsx apps/web/scripts/qa-add-signer-running.ts
 */
import fs from "fs";
import path from "path";

// Loader mínimo (dotenv não é dependência do repo). `override` porque o env
// puxado da Vercel corrige valores quebrados do .env.local; strip dos escapes
// literais `\n` que o `vercel env pull` escreve (ver memória do projeto).
function loadEnv(file: string, override: boolean) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "");
    if (override || !(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadEnv(path.resolve(__dirname, "../../../.env.local"), false);
// Env da Vercel (staging compartilha MASTER_ENCRYPTION_KEY com prod) — passado
// via QA_ENV_FILE pra não fixar caminho de máquina no script.
if (process.env.QA_ENV_FILE) loadEnv(process.env.QA_ENV_FILE, true);

async function main() {
  const {
    createEnvelope,
    addDocument,
    addSigner,
    addRequirement,
    activateEnvelope,
    bulkRequirements,
    notifySigner,
    listEnvelopeRequirements,
    listEnvelopeSigners,
    cancelEnvelope,
  } = await import("../src/lib/clicksign/envelopes");
  const { resolveClickSignCreds } = await import("../src/lib/clicksign/account");

  // Multitenant: token vive por org no DB (encriptado). Usa a primeira conta
  // conectada do DB apontado pelo .env.local.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const shared = process.env.SHARED_ORG_ID || "cmnt1ldo4000111bw4yo517k0";
  const account =
    (await prisma.clickSignAccount.findFirst({
      where: { status: "connected", orgId: shared },
      select: { orgId: true },
    })) ??
    (await prisma.clickSignAccount.findFirst({
      where: { status: "connected" },
      select: { orgId: true },
    }));
  await prisma.$disconnect();
  if (!account) throw new Error("Nenhuma ClickSignAccount connected no DB");
  const creds = (await resolveClickSignCreds(account.orgId)) ?? undefined;
  if (!creds) throw new Error(`Org ${account.orgId} sem conta ClickSign configurada`);
  console.log("creds resolvidas pra org", account.orgId);

  const pickId = (resp: unknown): string => {
    const data = (resp as { data?: { id?: string } | { id?: string }[] })?.data;
    const id = Array.isArray(data) ? data[0]?.id : data?.id;
    if (!id) throw new Error(`Resposta sem id: ${JSON.stringify(resp).slice(0, 400)}`);
    return id;
  };

  // PDF de 1 página mínimo válido.
  const minimalPdf = Buffer.from(
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
164
%%EOF`,
    "latin1"
  );

  console.log("1/8 criando envelope QA...");
  const env = await createEnvelope(
    { name: "QA add-signer em running — pode apagar" },
    creds
  );
  const envelopeId = pickId(env);
  console.log("   envelope:", envelopeId);

  try {
    console.log("2/8 adicionando documento...");
    const doc = await addDocument({
      envelopeId,
      filename: "qa-add-signer.pdf",
      contentBase64: minimalPdf.toString("base64"),
    }, creds);
    const documentId = pickId(doc);

    console.log("3/8 signer A + requirements (draft)...");
    const signerA = await addSigner({
      envelopeId,
      name: "QA Signer A",
      email: "olavo.piton+qa-add-a@gmail.com",
      hasDocumentation: false,
    }, creds);
    const signerAId = pickId(signerA);
    await addRequirement({
      envelopeId,
      documentClicksignId: documentId,
      signerClicksignId: signerAId,
      action: "provide_evidence",
      auth: "email",
    }, creds);
    await addRequirement({
      envelopeId,
      documentClicksignId: documentId,
      signerClicksignId: signerAId,
      action: "agree",
      role: "sign",
    }, creds);

    console.log("4/8 ativando envelope (running)...");
    await activateEnvelope(envelopeId, creds);

    console.log("5/8 signer B em envelope RUNNING (ponto crítico #1)...");
    const signerB = await addSigner({
      envelopeId,
      name: "QA Signer B (incluído pós-envio)",
      email: "olavo.piton+qa-add-b@gmail.com",
      hasDocumentation: false,
    }, creds);
    const signerBId = pickId(signerB);
    console.log("   signer B criado:", signerBId);

    console.log("6/8 requirements do B via bulk_requirements (ponto crítico #2)...");
    const bulkResp = await bulkRequirements(envelopeId, [
      {
        op: "add",
        action: "provide_evidence",
        auth: "email",
        documentClicksignId: documentId,
        signerClicksignId: signerBId,
      },
      {
        op: "add",
        action: "agree",
        role: "witness",
        documentClicksignId: documentId,
        signerClicksignId: signerBId,
      },
    ], creds);
    console.log("   bulk OK. Resposta (primeiros 600 chars):");
    console.log("  ", JSON.stringify(bulkResp).slice(0, 600));

    console.log("7/8 notificando signer B...");
    await notifySigner(envelopeId, signerBId, creds);

    const reqs = await listEnvelopeRequirements(envelopeId, creds);
    const signers = await listEnvelopeSigners(envelopeId, creds);
    const reqCount = Array.isArray((reqs as { data?: unknown[] }).data)
      ? (reqs as { data: unknown[] }).data.length
      : -1;
    const signerCount = Array.isArray((signers as { data?: unknown[] }).data)
      ? (signers as { data: unknown[] }).data.length
      : -1;
    console.log(`   pós-bulk: ${signerCount} signers, ${reqCount} requirements (esperado 2 e 4)`);
  } finally {
    console.log("8/8 cancelando envelope QA (limpeza)...");
    try {
      await cancelEnvelope(envelopeId, creds);
      console.log("   cancelado.");
    } catch (err) {
      console.error("   FALHA ao cancelar — cancele manualmente:", envelopeId, err);
    }
  }

  console.log("\nQA PASSOU: signer incluído + requirements via bulk em envelope running.");
}

main().catch((err) => {
  console.error("\nQA FALHOU:", err);
  process.exit(1);
});
