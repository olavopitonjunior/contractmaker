import { prisma } from "@/lib/db/prisma";
import {
  createApiToken,
  revokeApiToken,
  type ApiTokenScope,
} from "@/lib/auth/api-token";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { pushOrgToMax, deactivateOrgInMax } from "@/lib/max/push-org";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";

/**
 * Provisionamento do acesso do Max a um tenant.
 *
 * O Bearer do ImobPro deriva a org do DONO do token: `requireApiAuth` chama
 * `getUserOrg(userId, { subdomainHint: null })`, que sem subdomínio cai na
 * PRIMEIRA membership (`user-org.ts:114-124`). O token nem entra nessa conta.
 *
 * Daí o invariante que este módulo existe para garantir: **um usuário de serviço
 * por org, com exatamente uma membership**. Reusar o mesmo `User` entre tenants
 * faria todo token dele resolver sempre a primeira org — e a falha seria
 * silenciosa: escrita no tenant errado, com 200 OK e audit da org errada. O
 * próprio repo já registrou o risco (`lib/auth/context.ts:122-125`).
 *
 * Por que não uma credencial única de plataforma: ela não entrega a escrita.
 * `getEffectivePermissions(userId, orgId)` devolve `null` sem membership naquela
 * org, então `/api/proposals` e tudo sob `ensureLocacaoApiAccess` dariam 403 —
 * precisaria de membership do mesmo jeito. Somado a isso, um token só faria
 * todos os tenants dividirem o mesmo bucket de rate limit e o mesmo `userId` no
 * audit.
 */

/**
 * Ler persona, consultar a base, reportar custo — e criar formulário de venda.
 *
 * `documents:rw` (form de venda) e `locacao:rw` (form de locação) entraram na
 * Fase 3, quando o Max passou a criar formulário por conversa. São os escopos
 * que `POST /api/forms` e `POST /api/locacao/forms` exigem; note que os dois são
 * mais largos que o uso, porque o catálogo de escopos não tem granularidade
 * menor. O que contém o estrago é o resto: um token por org, um `CustomRole`
 * mínimo na membership (ver `upsertMaxRole` — `locacao:rw` sem `LEASE_CREATE`
 * não abre nada), e a confirmação humana do lado do Max — o modelo não tem
 * ferramenta que executa, só que PROPÕE.
 *
 * `users:delegate` segue de fora, mas o motivo MUDOU. Era pré-requisito: com
 * `X-Act-As-User` aceitando delegar para o `owner`, o token do bot valia o poder
 * do dono do tenant. Isso foi resolvido (#249, `lib/security/rbac/delegation.ts`
 * ligado em `context.ts`). Hoje ele fica de fora porque **não precisamos dele**:
 * o Deal nasce do usuário de serviço e o corretor entra por `corretorIds`, que o
 * `/api/forms` já usa para semear comissionados e destinatários de notificação.
 * Some a isso que `requireApiAuth` — o helper de TODAS as rotas que o Max chama —
 * ignora `X-Act-As-User`; a delegação só existe no `requireAuth` legado. Ligar o
 * escopo aqui não teria efeito nenhum, só superfície.
 *
 * **Escopo é congelado na emissão.** Mudar esta lista não altera token nenhum já
 * existente: é preciso reemitir por org, via
 * `POST /api/admin/orgs/[orgId]/max/reprovision`. Não desligue e religue a
 * feature no painel — aquele caminho passa por revogação e deixa uma janela com
 * o tenant sem credencial.
 */
export const MAX_SCOPES: ApiTokenScope[] = [
  "agents:r",
  "agents:rw",
  "metrics:r",
  "documents:rw",
  "locacao:rw",
];

/**
 * O papel do Max dentro do tenant — exatamente o que ele usa, nada além.
 *
 * Antes a membership era `viewer`, o que bastava porque nenhuma rota que o Max
 * chamava consultava permissão: `POST /api/forms` e `/api/agents/*` só olham
 * ESCOPO. A locação quebrou essa comodidade — `ensureLocacaoApiAccess` exige
 * `PERMISSION.LEASE_CREATE`, e `viewer` não tem.
 *
 * O caminho óbvio seria promover a `gestor_locacao`. Seria errado: aquele preset
 * dá CRUD de imóvel, geração de aluguel, criação de despesa e RESCISÃO de
 * contrato. O Max cria um formulário em branco; o resto seria poder guardado
 * para o dia em que alguém achasse um jeito de usá-lo.
 *
 * Daí um `CustomRole` por org, com um mapa que cabe em dez linhas e que dá para
 * ler inteiro numa revisão. As leituras estão aqui porque criar um formulário
 * que o próprio agente não pode consultar depois é meia funcionalidade.
 */
async function upsertMaxRole(
  orgId: string,
  createdBy: string
): Promise<{ id: string }> {
  const permissions = {
    // Vendas: o `/api/forms` não checa permissão, mas o dia em que checar não
    // pode ser o dia em que o Max para sem ninguém entender por quê.
    [PERMISSION.DEAL_VIEW_ASSIGNED_ONLY]: true,
    // Locação: só a criação. Sem editar, renovar ou rescindir.
    [PERMISSION.LEASE_VIEW]: true,
    [PERMISSION.LEASE_CREATE]: true,
    [PERMISSION.PROPERTY_VIEW]: true,
  };

  return prisma.customRole.upsert({
    where: { orgId_name: { orgId, name: MAX_ROLE_NAME } },
    create: {
      orgId,
      name: MAX_ROLE_NAME,
      description:
        "Papel do agente Max. Gerado pelo provisionamento — editar à mão " +
        "é sobrescrito no próximo sync.",
      permissions,
      createdBy,
    },
    // Reescreve sempre: o mapa é código, não configuração. Se alguém ampliar
    // pela tela de papéis, o sync devolve ao mínimo — que é o ponto de o papel
    // existir.
    update: { permissions },
    select: { id: true },
  });
}

/** Nome do `CustomRole` do Max. Único por org (`@@unique([orgId, name])`). */
export const MAX_ROLE_NAME = "Max (agente)";

/** Domínio dos usuários de serviço. Não recebe e-mail — é identificador. */
const SERVICE_EMAIL_DOMAIN = "agents.imobpro.local";

/** Chave do agente externo em `AgentProvisioning` e no registry. */
export const MAX_AGENT_KEY = "max";

export function serviceUserEmail(orgId: string): string {
  return `max+${orgId}@${SERVICE_EMAIL_DOMAIN}`;
}

export interface ProvisionResult {
  status: "created" | "rotated" | "failed";
  orgId: string;
  orgName: string;
  serviceUserId?: string;
  tokenId?: string;
  /** Existe só nesta resposta — o banco guarda apenas o sha256. */
  rawToken?: string;
  reason?: string;
}

/**
 * Cria (ou rotaciona) o acesso do Max a uma org.
 *
 * Idempotente no que dá para ser: o usuário e a membership são upsert; o TOKEN
 * não, porque `createApiToken` só devolve o valor cru uma vez e o banco guarda
 * apenas o hash — não há "checar se já existe e reusar". Então a regra é emitir
 * um novo e revogar o anterior, e é por isso que chamar duas vezes devolve
 * `rotated` em vez de `created`.
 */
export async function provisionMaxForOrg(params: {
  orgId: string;
  scopes?: ApiTokenScope[];
}): Promise<ProvisionResult> {
  const { orgId } = params;
  const scopes = params.scopes ?? MAX_SCOPES;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) {
    return { status: "failed", orgId, orgName: "", reason: "org não encontrada" };
  }

  const email = serviceUserEmail(orgId);

  // `passwordHash: null` é o que impede login interativo: o provider Credentials
  // do NextAuth precisa do hash pra autenticar. `phone: null` importa tanto
  // quanto — `User.phone` é @unique GLOBAL, e um usuário de serviço com telefone
  // apareceria no `by-phone` como se fosse gente.
  const serviceUser = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: `Max (${org.name})`,
      passwordHash: null,
      phone: null,
      emailVerified: new Date(),
    },
    update: { name: `Max (${org.name})` },
    select: { id: true },
  });

  const papel = await upsertMaxRole(orgId, serviceUser.id);

  // `isSystem` marca a membership para que a tela de membros recuse removê-la.
  // No `update` também, e não só no `create`: as memberships provisionadas
  // antes deste campo existir precisam ganhá-lo no primeiro sync.
  //
  // O papel entra no `update` pelo mesmo motivo: as memberships criadas como
  // `viewer` (antes da locação) precisam migrar no primeiro sync, senão o Max
  // continua sem `LEASE_CREATE` e a criação de formulário de locação dá 403 —
  // com o token novo já emitido e o escopo já concedido, que é o pior lugar
  // pra descobrir que falta uma permissão.
  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: serviceUser.id, orgId } },
    create: {
      userId: serviceUser.id,
      orgId,
      role: "custom",
      customRoleId: papel.id,
      isSystem: true,
    },
    update: { role: "custom", customRoleId: papel.id, isSystem: true },
    select: { id: true },
  });

  /**
   * O invariante, verificado e não presumido. Se este usuário acabou em duas
   * orgs, qualquer token dele resolve sempre a primeira — então é melhor falhar
   * aqui, ruidosamente, do que emitir uma credencial que escreve no tenant
   * errado.
   */
  const memberships = await prisma.orgMembership.count({
    where: { userId: serviceUser.id },
  });
  if (memberships !== 1) {
    return {
      status: "failed",
      orgId,
      orgName: org.name,
      serviceUserId: serviceUser.id,
      reason:
        `usuário de serviço tem ${memberships} memberships (esperado 1). ` +
        `Com mais de uma, getUserOrg resolveria sempre a primeira e o Max ` +
        `escreveria no tenant errado.`,
    };
  }

  const anteriores = await prisma.userApiToken.findMany({
    where: { userId: serviceUser.id, revokedAt: null },
    select: { id: true },
  });

  const { rawToken, token } = await createApiToken({
    userId: serviceUser.id,
    name: `Max (${org.name})`,
    scopes,
  });

  // Revoga DEPOIS de emitir: entre as duas operações o tenant tem duas
  // credenciais válidas, o que é inofensivo. Na ordem inversa haveria uma
  // janela sem nenhuma.
  for (const antigo of anteriores) {
    await revokeApiToken(antigo.id, serviceUser.id);
  }

  return {
    status: anteriores.length > 0 ? "rotated" : "created",
    orgId,
    orgName: org.name,
    serviceUserId: serviceUser.id,
    tokenId: token.id,
    rawToken,
  };
}

/** Revoga o acesso do Max. A membership fica — remover apagaria o rastro de audit. */
export async function deprovisionMaxForOrg(orgId: string): Promise<{
  revoked: number;
}> {
  const serviceUser = await prisma.user.findUnique({
    where: { email: serviceUserEmail(orgId) },
    select: { id: true },
  });
  if (!serviceUser) return { revoked: 0 };

  const result = await prisma.userApiToken.updateMany({
    where: { userId: serviceUser.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revoked: result.count };
}

/**
 * Reage à transição do flag no painel: ligou → provisiona e entrega ao Max;
 * desligou nos DOIS módulos → revoga e desativa lá.
 *
 * Chamado de `PATCH /api/admin/orgs/[orgId]/modules` em `waitUntil`, para não
 * segurar a resposta do painel — mas o resultado é devolvido para quem quiser
 * registrar, porque falha silenciosa aqui é o pior estado possível: a feature
 * fica verde e o agente, mudo.
 *
 * A leitura de módulos acontece DEPOIS do upsert do PATCH de propósito.
 * `getOrgModules` é cacheado por request (`React.cache`); uma leitura antes do
 * upsert envenenaria o cache com o estado antigo e este código decidiria pelo
 * valor errado.
 */
export async function syncMaxForOrg(orgId: string): Promise<
  | { action: "provisioned"; delivered: boolean; detail?: string }
  | { action: "deprovisioned"; revoked: number }
  | { action: "noop" }
> {
  const view = await getOrgModules(orgId);
  const ligado =
    isFeatureEnabled(view, FEATURE.VENDAS_MAX) ||
    isFeatureEnabled(view, FEATURE.LOCACAO_MAX);

  if (!ligado) {
    // Só revoga quando NENHUM dos dois módulos usa o Max — o token cobre os
    // dois, então desligar vendas mantendo locação não pode derrubar o agente.
    const { revoked } = await deprovisionMaxForOrg(orgId);
    if (revoked > 0) await deactivateOrgInMax(orgId);
    await recordProvisioning(orgId, { status: "revoked", lastError: null });
    return { action: "deprovisioned", revoked };
  }

  const r = await provisionMaxForOrg({ orgId });
  if (r.status === "failed") {
    // Não chegou a emitir token: `failed` (e não `pending_delivery`), porque
    // reenviar não resolve — o cron precisa reprovisionar do zero.
    await recordProvisioning(orgId, {
      status: "failed",
      lastError: r.reason ?? "provisionamento falhou",
      bumpAttempts: true,
    });
    return { action: "provisioned", delivered: false, detail: r.reason };
  }

  const push = await pushOrgToMax({
    orgId: r.orgId,
    orgName: r.orgName,
    apiToken: r.rawToken!,
  });

  if (!push.ok) {
    // O token existe e é válido; o que faltou foi a entrega. Não revogamos:
    // reprovisionar depois entrega o mesmo estado, e revogar aqui só criaria
    // um tenant sem credencial nenhuma.
    const detail = `${push.reason}${push.detail ? `: ${push.detail}` : ""}`;
    await recordProvisioning(orgId, {
      status: "pending_delivery",
      serviceUserId: r.serviceUserId,
      tokenId: r.tokenId,
      lastError: detail,
      bumpAttempts: true,
    });
    return { action: "provisioned", delivered: false, detail };
  }

  await recordProvisioning(orgId, {
    status: "active",
    serviceUserId: r.serviceUserId,
    tokenId: r.tokenId,
    deliveredAt: new Date(),
    lastError: null,
  });
  return { action: "provisioned", delivered: true };
}

/**
 * Grava o estado do ciclo. Nunca lança: o provisionamento em si já aconteceu, e
 * derrubar a resposta do painel por causa da linha de observabilidade trocaria
 * um problema de visibilidade por um de funcionamento.
 *
 * `attempts` zera quando um ciclo fecha bem e incrementa quando falha — é o que
 * o cron usa para espaçar e para parar de insistir num erro que não é
 * transitório.
 */
async function recordProvisioning(
  orgId: string,
  data: {
    status: "active" | "pending_delivery" | "failed" | "revoked";
    serviceUserId?: string;
    tokenId?: string;
    deliveredAt?: Date;
    lastError: string | null;
    bumpAttempts?: boolean;
  }
): Promise<void> {
  const { bumpAttempts, ...rest } = data;
  try {
    await prisma.agentProvisioning.upsert({
      where: { orgId_agentKey: { orgId, agentKey: MAX_AGENT_KEY } },
      create: {
        orgId,
        agentKey: MAX_AGENT_KEY,
        ...rest,
        attempts: bumpAttempts ? 1 : 0,
      },
      update: {
        ...rest,
        attempts: bumpAttempts ? { increment: 1 } : 0,
      },
    });
  } catch (err) {
    console.error("[max-provisioning] falha ao gravar estado:", err);
  }
}
