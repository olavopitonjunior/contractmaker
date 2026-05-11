/**
 * Helpers canônicos pra resolver "qual AsaasAccount usar" e checar capabilities.
 *
 * Substitui o padrão antigo `prisma.asaasAccount.findUnique({ where: { orgId } })`
 * espalhado por 28 sites — agora cada site delega resolução pra `resolveAsaasAccount`.
 *
 * Capabilities (per-account, granulares):
 *   - "view"           — KPIs, extrato, lista de cobranças, listagem de clientes
 *   - "create_charge"  — emitir cobrança / refund / cancelar / mark-received-in-cash
 *   - "init_transfer"  — sacar saldo (PIX/TED) com dual-approval acima do cap
 *   - "configure"      — taxas, branding, notify*, splits — OrgFinancialSettings
 *
 * Owner da org (OrgMembership.role === "owner") bypassa as 4 capabilities
 * implicitamente — sem precisar inserir rows em AsaasAccountPermission.
 */

import type { AsaasAccount } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";

export type AccountCapability =
  | "view"
  | "create_charge"
  | "init_transfer"
  | "configure";

export const ACCOUNT_CAPABILITIES: AccountCapability[] = [
  "view",
  "create_charge",
  "init_transfer",
  "configure",
];

export const ACCOUNT_CAPABILITY_LABELS_PT: Record<AccountCapability, string> = {
  view: "Visualizar (KPIs, extrato, cobranças)",
  create_charge: "Criar cobranças nessa conta",
  init_transfer: "Iniciar transferência/saque",
  configure: "Configurar (taxas, branding, splits)",
};

/**
 * Owner da org tem todas as capabilities implicitamente em todas as contas.
 * Resolve via OrgMembership.role === "owner".
 */
export async function isOrgOwner(userId: string, orgId: string): Promise<boolean> {
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { role: true },
  });
  return m?.role === "owner";
}

/**
 * Verifica se o user tem determinada capability na conta. Owner sempre passa.
 */
export async function userHasAccountCapability(
  userId: string,
  accountId: string,
  cap: AccountCapability
): Promise<boolean> {
  const account = await prisma.asaasAccount.findUnique({
    where: { id: accountId },
    select: { orgId: true, archivedAt: true },
  });
  if (!account) return false;
  if (account.archivedAt) return false;

  if (await isOrgOwner(userId, account.orgId)) return true;

  const perm = await prisma.asaasAccountPermission.findUnique({
    where: {
      accountId_userId_capability: { accountId, userId, capability: cap },
    },
    select: { id: true },
  });
  return !!perm;
}

/**
 * Lista contas acessíveis ao user — owner vê todas (não-arquivadas);
 * non-owner vê só contas com ≥1 grant.
 */
export async function listAccessibleAccounts(
  userId: string,
  orgId: string
): Promise<AsaasAccount[]> {
  const owner = await isOrgOwner(userId, orgId);
  if (owner) {
    return prisma.asaasAccount.findMany({
      where: { orgId, archivedAt: null },
      orderBy: [{ archivedAt: "asc" }, { createdAt: "asc" }],
    });
  }

  const grants = await prisma.asaasAccountPermission.findMany({
    where: { userId, account: { orgId, archivedAt: null } },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  if (grants.length === 0) return [];
  const ids = grants.map((g) => g.accountId);
  return prisma.asaasAccount.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Mapa capability → conjunto de accountIds em que o user tem aquela cap.
 * Útil pra renderizar UI (botão "Nova cobrança" só aparece em conta com create_charge).
 */
export async function getAccountCapabilitiesByUser(
  userId: string,
  orgId: string
): Promise<Record<string, AccountCapability[]>> {
  const owner = await isOrgOwner(userId, orgId);
  const accounts = await listAccessibleAccounts(userId, orgId);
  if (owner) {
    const out: Record<string, AccountCapability[]> = {};
    for (const a of accounts) out[a.id] = [...ACCOUNT_CAPABILITIES];
    return out;
  }
  const grants = await prisma.asaasAccountPermission.findMany({
    where: {
      userId,
      account: { orgId, archivedAt: null },
    },
    select: { accountId: true, capability: true },
  });
  const out: Record<string, AccountCapability[]> = {};
  for (const g of grants) {
    if (!out[g.accountId]) out[g.accountId] = [];
    out[g.accountId].push(g.capability as AccountCapability);
  }
  return out;
}

export interface ResolveAsaasAccountOptions {
  userId: string;
  orgId: string;
  /** ?accountId= ou body.accountId — preferido se válido + cap presente. */
  hintAccountId?: string | null;
  /**
   * Se setado, exige que o user tenha essa capability na conta resolvida.
   * Se ausente, usa "view" como mínimo.
   */
  requireCapability?: AccountCapability;
}

export interface ResolveAsaasAccountResult {
  account: AsaasAccount;
  /** Razão da escolha — útil pra debug/teste. */
  reason: "hint" | "active" | "first_accessible";
}

/**
 * Ordem de resolução:
 *   1. hintAccountId válido + cap → vence
 *   2. org.activeAsaasAccountId + cap → fallback
 *   3. primeira conta acessível com a cap pedida → fallback final
 *   null se nenhuma satisfaz
 */
export async function resolveAsaasAccount(
  opts: ResolveAsaasAccountOptions
): Promise<ResolveAsaasAccountResult | null> {
  const cap = opts.requireCapability ?? "view";

  // 1) hint
  if (opts.hintAccountId) {
    const account = await prisma.asaasAccount.findFirst({
      where: { id: opts.hintAccountId, orgId: opts.orgId, archivedAt: null },
    });
    if (account && (await userHasAccountCapability(opts.userId, account.id, cap))) {
      return { account, reason: "hint" };
    }
  }

  // 2) active da org
  const org = await prisma.organization.findUnique({
    where: { id: opts.orgId },
    select: { activeAsaasAccountId: true },
  });
  if (org?.activeAsaasAccountId) {
    const account = await prisma.asaasAccount.findFirst({
      where: { id: org.activeAsaasAccountId, archivedAt: null },
    });
    if (account && (await userHasAccountCapability(opts.userId, account.id, cap))) {
      return { account, reason: "active" };
    }
  }

  // 3) primeira acessível com a cap (owner: primeira não-arquivada; non-owner: primeira com grant)
  const accessible = await listAccessibleAccounts(opts.userId, opts.orgId);
  for (const a of accessible) {
    if (await userHasAccountCapability(opts.userId, a.id, cap)) {
      return { account: a, reason: "first_accessible" };
    }
  }
  return null;
}

/**
 * Carrega a conta + decrypt da apiKey. Usado em todo place que chama Asaas API.
 *
 * NÃO faz checagem de permissão — caller já resolveu via resolveAsaasAccount.
 */
export async function getAccountWithApiKey(accountId: string): Promise<{
  account: AsaasAccount;
  apiKey: string;
}> {
  const account = await prisma.asaasAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) {
    throw new Error(`AsaasAccount ${accountId} não encontrada`);
  }
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });
  return { account, apiKey };
}

/**
 * Mascara walletId pra exibição em UI (mostra primeiros 8 + últimos 4).
 */
export function maskWalletId(walletId: string | null | undefined): string {
  if (!walletId) return "—";
  if (walletId.length <= 12) return walletId;
  return `${walletId.slice(0, 8)}***${walletId.slice(-4)}`;
}

export class AccountNotFoundError extends Error {
  status = 404;
  code = "ACCOUNT_NOT_FOUND";
  constructor(message = "Conta Asaas não encontrada ou inacessível") {
    super(message);
    this.name = "AccountNotFoundError";
  }
}

export class AccountNotApprovedError extends Error {
  status = 422;
  code = "ACCOUNT_NOT_APPROVED";
  accountStatus: string;
  constructor(accountStatus: string) {
    super(`Conta Asaas com status ${accountStatus} — operação requer APPROVED`);
    this.name = "AccountNotApprovedError";
    this.accountStatus = accountStatus;
  }
}
