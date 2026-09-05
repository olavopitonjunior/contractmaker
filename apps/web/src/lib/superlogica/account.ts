// Resolução da credencial Superlógica por org (multitenant), no molde de
// lib/clicksign/account.ts: os tokens vivem no banco cifrados com AES-256-GCM
// (lib/security/crypto.ts) e só são remontados aqui, no servidor. Não há
// fallback global de .env — sem conta conectada, a org não exporta nada.

import type { SuperlogicaAccount } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";
import type { SuperlogicaCredentials } from "./client";

export interface SuperlogicaOrgCreds extends SuperlogicaCredentials {
  /** Nome da licença/base (ex.: "adm037585"), só para links de tela. */
  licenca: string;
}

/** Lançado quando a org não tem conta Superlógica conectada. As rotas mapeiam
 *  para 409 com CTA de conexão em Configurações › Integrações. */
export class SuperlogicaNotConfiguredError extends Error {
  constructor(
    message = "Superlógica não conectada para esta imobiliária. Conecte em Configurações › Integrações › Superlógica."
  ) {
    super(message);
    this.name = "SuperlogicaNotConfiguredError";
  }
}

/** Decripta os dois tokens da conta. Isolado para o connect/test reusarem. */
export function decryptAccountCreds(account: SuperlogicaAccount): SuperlogicaOrgCreds {
  return {
    licenca: account.licenca,
    appToken: decryptSecret({
      ciphertext: account.appTokenEncrypted,
      iv: account.appTokenIvBase64,
      tag: account.appTokenTagBase64,
    }),
    accessToken: decryptSecret({
      ciphertext: account.accessTokenEncrypted,
      iv: account.accessTokenIvBase64,
      tag: account.accessTokenTagBase64,
    }),
  };
}

/** Credenciais da conta da org, ou null se não conectada/desconectada. */
export async function getOrgSuperlogicaCreds(
  orgId: string
): Promise<SuperlogicaOrgCreds | null> {
  const account = await prisma.superlogicaAccount.findUnique({ where: { orgId } });
  if (!account || account.status === "disconnected") return null;
  return decryptAccountCreds(account);
}

/** Igual a getOrgSuperlogicaCreds, mas lança quando não configurado. */
export async function requireSuperlogicaCreds(orgId: string): Promise<SuperlogicaOrgCreds> {
  const creds = await getOrgSuperlogicaCreds(orgId);
  if (!creds) throw new SuperlogicaNotConfiguredError();
  return creds;
}

export async function isSuperlogicaConfigured(orgId: string): Promise<boolean> {
  return (await getOrgSuperlogicaCreds(orgId)) !== null;
}

/**
 * Existe conta gravada e não desconectada — SEM decifrar tokens. É o teste
 * certo para render de página (o decrypt pode lançar por chave de cifra
 * ausente/rotacionada e não pode derrubar a página do negócio) e é a mesma
 * regra que `loadExportContext` usa.
 */
export async function hasSuperlogicaAccount(orgId: string): Promise<boolean> {
  const row = await prisma.superlogicaAccount.findUnique({
    where: { orgId },
    select: { status: true },
  });
  return !!row && row.status !== "disconnected";
}

/** Link da venda na tela da Superlógica (a tela mora em apps.superlogica.net,
 *  independente da licença; a licença vai só na sessão do usuário). */
export function superlogicaVendaUrl(vendaId: string | number): string {
  return `https://apps.superlogica.net/imobiliaria/vendas/id/${vendaId}`;
}

/**
 * Projeção segura da conta para o cliente: nunca inclui os tokens.
 * `configured` = existe conta gravada (mesmo em `status: "error"`, a tela
 * continua no modo conectado, com o erro à vista e os botões Testar /
 * Reconectar / Desconectar); `connected` = última validação passou.
 */
export function publicAccountView(account: SuperlogicaAccount | null) {
  if (!account) {
    return { configured: false, connected: false, status: "disconnected" as const, settings: null };
  }
  return {
    configured: true,
    connected: account.status === "connected",
    status: account.status,
    licenca: account.licenca,
    accountName: account.accountName,
    lastValidatedAt: account.lastValidatedAt,
    lastError: account.lastError,
    settings: {
      contaBancariaId: account.contaBancariaId,
      filialId: account.filialId,
      contaContabilComissao: account.contaContabilComissao,
      contaContabilDescricao: account.contaContabilDescricao,
      tipoImovelPadrao: account.tipoImovelPadrao,
      tipoPagamentoComissao: account.tipoPagamentoComissao,
      tipoRecebimentoComissao: account.tipoRecebimentoComissao,
      emitirNf: account.emitirNf,
      gerarDimob: account.gerarDimob,
      vencimentoDias: account.vencimentoDias,
      tetoValorCents: account.tetoValorCents,
    },
  };
}
