import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/security/crypto";

async function main() {
  const idx = process.argv.indexOf("--asaas-id");
  const id = idx >= 0 ? process.argv[idx + 1] : null;
  const orgIdx = process.argv.indexOf("--org-id");
  const orgId = orgIdx >= 0 ? process.argv[orgIdx + 1] : null;
  if (!id || !orgId) {
    console.error("Use --asaas-id <id> --org-id <orgId> (multitenant: sem default de org)");
    process.exit(1);
  }
  const p = new PrismaClient();
  try {
    const account = await p.asaasAccount.findFirst({
      where: { orgId },
    });
    if (!account) throw new Error("AsaasAccount not found");
    const apiKey = decryptSecret({
      ciphertext: account.apiKeyEncrypted,
      iv: account.apiKeyIvBase64,
      tag: account.apiKeyTagBase64,
    });
    const baseUrl =
      process.env.ASAAS_ENV === "production"
        ? "https://api.asaas.com/v3"
        : "https://api-sandbox.asaas.com/v3";
    const res = await fetch(`${baseUrl}/transfers/${id}`, {
      headers: { access_token: apiKey, Accept: "application/json" },
    });
    const text = await res.text();
    console.log("HTTP", res.status);
    console.log(text);
  } finally {
    await p.$disconnect();
  }
}
main().catch(console.error);
