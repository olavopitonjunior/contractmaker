import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";

/**
 * ClickSign per-org (Fase 1c, ADITIVO). `mode="white_label"` usa a chave própria
 * do tenant (subconta WL); senão cai no pool da plataforma (env global
 * CLICKSIGN_API_TOKEN / CLICKSIGN_WEBHOOK_SECRET). O fluxo de envelope existente
 * continua usando o pool global — adoção do per-org é incremental via este helper.
 *
 * Provisionamento automático da subconta WL (chamada à API White Label do
 * ClickSign) é GATED no acordo comercial — `storeClickSignAccount` cobre o
 * cadastro manual das credenciais por enquanto.
 */

export interface ResolvedClickSign {
  mode: "white_label" | "platform_pool";
  apiToken: string;
  hmacSecret: string | null;
  whiteLabelId: string | null;
}

export async function getClickSignAccountForOrg(orgId: string) {
  return prisma.clickSignAccount.findUnique({ where: { orgId } });
}

export async function getClickSignForOrg(orgId: string): Promise<ResolvedClickSign> {
  const acct = await prisma.clickSignAccount.findUnique({ where: { orgId } });
  if (
    acct &&
    acct.mode === "white_label" &&
    acct.status === "ACTIVE" &&
    acct.apiKeyCiphertext &&
    acct.apiKeyIv &&
    acct.apiKeyTag
  ) {
    const apiToken = decryptSecret({
      ciphertext: acct.apiKeyCiphertext,
      iv: acct.apiKeyIv,
      tag: acct.apiKeyTag,
    });
    const hmacSecret =
      acct.hmacSecretCiphertext && acct.hmacSecretIv && acct.hmacSecretTag
        ? decryptSecret({
            ciphertext: acct.hmacSecretCiphertext,
            iv: acct.hmacSecretIv,
            tag: acct.hmacSecretTag,
          })
        : null;
    return {
      mode: "white_label",
      apiToken,
      hmacSecret,
      whiteLabelId: acct.whiteLabelId ?? null,
    };
  }
  // Fallback: pool compartilhado da plataforma.
  return {
    mode: "platform_pool",
    apiToken: process.env.CLICKSIGN_API_TOKEN ?? "",
    hmacSecret: process.env.CLICKSIGN_WEBHOOK_SECRET ?? null,
    whiteLabelId: null,
  };
}

export async function storeClickSignAccount(params: {
  orgId: string;
  mode: "white_label" | "platform_pool";
  apiToken?: string | null;
  hmacSecret?: string | null;
  whiteLabelId?: string | null;
}) {
  const apiEnc = params.apiToken ? encryptSecret(params.apiToken) : null;
  const hmacEnc = params.hmacSecret ? encryptSecret(params.hmacSecret) : null;
  const data = {
    mode: params.mode,
    whiteLabelId: params.whiteLabelId ?? null,
    apiKeyCiphertext: apiEnc?.ciphertext ?? null,
    apiKeyIv: apiEnc?.iv ?? null,
    apiKeyTag: apiEnc?.tag ?? null,
    hmacSecretCiphertext: hmacEnc?.ciphertext ?? null,
    hmacSecretIv: hmacEnc?.iv ?? null,
    hmacSecretTag: hmacEnc?.tag ?? null,
    status: "ACTIVE" as const,
  };
  return prisma.clickSignAccount.upsert({
    where: { orgId: params.orgId },
    update: data,
    create: { orgId: params.orgId, ...data },
  });
}
