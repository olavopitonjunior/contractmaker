import { prisma } from "@/lib/db/prisma";
import { can, getEffectivePermissions } from "@/lib/security/rbac/check";
import {
  MANAGER_CONFIGURABLE_PERMISSIONS,
  PERMISSION,
  type PermissionKey,
  type PermissionMap,
} from "@/lib/security/rbac/permissions";
import {
  ROLE_PRESETS,
  resolvePermissions,
  type RolePreset,
} from "@/lib/security/rbac/roles";

/** Teto de e-mails por convite — ver `getOrgApproverEmails`. */
const MAX_APPROVER_NOTIFICATIONS = 25;

const DEFAULT_EXPIRY_DAYS = 14;
const APPROVER_FALLBACK = "olavo.piton@gmail.com";

/** Lista de emails que podem aprovar/rejeitar convites. Configurável via
 *  INVITE_APPROVER_EMAILS (vírgula-separado). Se ausente, default Olavo. */
export function getApproverEmails(): string[] {
  const raw = process.env.INVITE_APPROVER_EMAILS;
  if (!raw) return [APPROVER_FALLBACK];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Lista de emails que recebem notificação de pending (não aprovam).
 *  Configurável via INVITE_NOTIFY_EMAILS. Default vazia. */
export function getNotifyEmails(): string[] {
  const raw = process.env.INVITE_NOTIFY_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isApprover(email: string | null | undefined): boolean {
  if (!email) return false;
  return getApproverEmails().includes(email.toLowerCase());
}

/**
 * Quem pode decidir (aprovar/reprovar) um convite nesta org.
 *
 * Duas fontes, em OR:
 *  - a allowlist de env `INVITE_APPROVER_EMAILS` — o aprovador designado, que
 *    existe desde antes do RBAC e continua valendo mesmo sem membership;
 *  - a permissão `org.members.approve`, que os presets `owner` e `admin`
 *    carregam por padrão (`fullAccess`). É por aqui que o perfil de
 *    administrador passou a aprovar/reprovar usuários.
 *
 * Manter as duas é deliberado: a env é a porta de emergência de quem opera a
 * plataforma, e derrubá-la trancaria a org caso a última membership de
 * admin/owner saia por engano.
 *
 * `impersonatedByEmail` existe porque essa porta de emergência é justamente a
 * que a impersonação fechava. Sob "trocar de tenant", `userId` e `email` são os
 * do DONO do tenant — então a allowlist, que é gate de PLATAFORMA, era
 * comparada contra o e-mail do cliente e nunca casava. Na prática o ramo RBAC
 * cobre o caso comum (o dono tem preset `owner`, logo tem a permissão); o que
 * a allowlist recupera é o tenant cujo owner PERDEU a permissão — exatamente a
 * situação para a qual a porta de emergência existe.
 */
export interface InvitationDecider {
  userId: string;
  orgId: string;
  email?: string | null;
  /** `ctx.impersonatedByUserId` — presença dele é o que marca impersonação. */
  impersonatedByUserId?: string | null;
  /** E-mail do admin real sob impersonation (`ctx.impersonatedByEmail`). */
  impersonatedByEmail?: string | null;
}

/**
 * E-mail do humano que de fato agiu.
 *
 * Decide pelo ESTADO de impersonação, não por "o e-mail do impersonador
 * resolveu". Com `??`, uma sessão impersonada cujo `impersonatedByEmail` viesse
 * vazio cairia silenciosamente no e-mail do DONO do tenant — que é exatamente o
 * bug que este PR conserta, reintroduzido pela porta dos fundos. Sob
 * impersonação sem e-mail do ator real, o certo é não casar com ninguém.
 */
function actingEmail(params: InvitationDecider): string | null | undefined {
  return params.impersonatedByUserId
    ? params.impersonatedByEmail
    : params.email;
}

export async function canApproveInvitations(
  params: InvitationDecider
): Promise<boolean> {
  // Só o ator humano faz sentido contra uma allowlist de operador de plataforma.
  if (isApprover(actingEmail(params))) return true;
  const effective = await getEffectivePermissions(params.userId, params.orgId);
  return can(effective, PERMISSION.ORG_MEMBERS_APPROVE);
}

/**
 * Teto de papel: ninguém admite alguém mais poderoso que si mesmo.
 *
 * Sem isto o par `org.members.invite` + `org.members.approve` vira primitiva de
 * ESCALAÇÃO. `POST /api/org/invitations` só exige INVITE e não checa teto,
 * `INVITATION_ROLE_VALUES` inclui `admin`, e o approve passou a aceitar quem
 * tem APPROVE — então uma CustomRole com só essas duas chaves convidaria
 * `admin`, aprovaria a si mesma pelo e-mail que controla e sairia com acesso
 * quase total, sem nunca ter tido `org.members.change_role`. Antes o segundo
 * passo exigia a allowlist de env e o laço não fechava; o gate novo é que o
 * fecha, então o teto entra junto.
 *
 * Regra: as permissões do papel alvo têm de ser SUBCONJUNTO das de quem
 * decide. `admin` aprovando `admin` passa (igualdade); a CustomRole acima
 * reprova. Quem está na allowlist de env é operador de plataforma e não tem
 * teto — a allowlist já é a fronteira de confiança dele.
 *
 * **Alcance:** isto fecha o caminho de CONVITE. A porta lateral —
 * `POST /api/org/members`, que criava membership com papel arbitrário protegido
 * só por `org.members.invite` — foi fechada depois pela issue #452, com o mesmo
 * teto: ver `canGrantRole`. `requireElevation` continua no-op deliberado, então
 * o teto é a única barreira real nas duas rotas.
 *
 * Devolve o motivo separado porque "não pode decidir" e "não pode conceder ESTE
 * papel" são coisas diferentes para quem lê a mensagem de erro.
 */
export async function canApproveInvitationForRole(
  params: InvitationDecider & { targetRole: string }
): Promise<{ allowed: true } | { allowed: false; reason: "forbidden" | "role_ceiling" }> {
  if (isApprover(actingEmail(params))) return { allowed: true };

  // Um lookup só: antes o gate e o teto resolviam as mesmas permissões em
  // chamadas separadas, 2-3 idas ao banco por aprovação.
  const effective = await getEffectivePermissions(params.userId, params.orgId);
  if (!can(effective, PERMISSION.ORG_MEMBERS_APPROVE)) {
    return { allowed: false, reason: "forbidden" };
  }

  // O convite não carrega customRoleId, então `custom` cai no `null` do
  // resolver e continua negado — comportamento idêntico ao de antes.
  const withinCeiling = await isWithinRoleCeiling({
    orgId: params.orgId,
    effective,
    targetRole: params.targetRole,
  });
  return withinCeiling
    ? { allowed: true }
    : { allowed: false, reason: "role_ceiling" };
}

/**
 * O teto puro: as permissões do papel alvo têm de ser SUBCONJUNTO das de quem
 * concede.
 *
 * Sem gate e sem allowlist de propósito. Os dois caminhos que concedem papel
 * exigem permissões DIFERENTES — `ORG_MEMBERS_APPROVE` na aprovação de convite,
 * `ORG_MEMBERS_INVITE` em `POST /api/org/members` — e embutir um gate aqui
 * trocaria em silêncio a permissão exigida por uma das rotas, que é mudança de
 * comportamento disfarçada de correção. Cada call-site faz o seu gate; o teto é
 * a única coisa que eles compartilham, e é isto.
 */
export async function isWithinRoleCeiling(params: {
  orgId: string;
  effective: Awaited<ReturnType<typeof getEffectivePermissions>>;
  targetRole: string;
  targetCustomRoleId?: string | null;
}): Promise<boolean> {
  const target = await resolveTargetPermissions(
    params.orgId,
    params.targetRole,
    params.targetCustomRoleId
  );
  // `null` = papel cujas permissões não dá para conhecer aqui. Um mapa vazio
  // passaria o `.every` VACUAMENTE e o teto liberaria conceder qualquer
  // CustomRole da org — nega em vez de adivinhar.
  if (target === null) return false;
  // Ator sem membership resolve `effective` para `null`. Com um alvo de mapa
  // vazio o `.every` passaria VACUAMENTE e o teto diria "dentro" para quem não
  // tem permissão nenhuma. Hoje nenhum call-site chega aqui sem gate, mas isto
  // é primitiva de segurança exportada: o invariante tem de valer sozinho, não
  // por sorte de quem chama. (O `effective!` de antes estourava TypeError neste
  // caso — fail-closed por acidente; a guarda torna a intenção explícita.)
  if (!params.effective) return false;
  // Extraído para local: o narrowing de `params.effective` não atravessa o
  // callback do `.every`, e o tsc reprova a propriedade lá dentro.
  const { permissions } = params.effective;
  return Object.entries(target).every(
    ([key, granted]) =>
      granted !== true || permissions[key as PermissionKey] === true
  );
}

/**
 * Teto da concessão DIRETA de papel — `POST /api/org/members`, que cria a
 * membership sem passar pela fila de convites.
 *
 * Essa rota era a porta lateral do teto que o PR #447 instalou: `role` vinha do
 * body, `ROLE_VALUES` inclui `admin`, e o único gate era `ORG_MEMBERS_INVITE` —
 * quem podia convidar criava um `admin` em UMA chamada, sem nunca ter tido
 * `org.members.change_role`. `requireElevation` dá a impressão de segunda
 * barreira, mas é no-op deliberado (`security/elevation.ts`); religá-la afeta
 * muitas rotas e é outro trabalho, não este.
 *
 * NÃO herda o curto-circuito de `isApprover`. A allowlist de e-mail por env é a
 * fronteira de confiança do fluxo de CONVITE; esta rota nunca a teve, e
 * importá-la junto seria ALARGAR permissão dentro de uma correção de segurança.
 * Não trava ninguém: `admin` concedendo `admin` passa por igualdade, e `owner`
 * passa por superset — a rota não aceita `owner` como ALVO (não está em
 * `ROLE_VALUES`), só como quem concede.
 */
export async function canGrantRole(
  params: Pick<InvitationDecider, "userId" | "orgId"> & {
    targetRole: string;
    targetCustomRoleId?: string | null;
  }
): Promise<{ allowed: true } | { allowed: false; reason: "role_ceiling" }> {
  // Resolve o alvo por conta própria, mesmo quando o caller já buscou a
  // CustomRole para validar existência. Aceitar as permissões do alvo por
  // parâmetro pouparia uma query e é exatamente como um teto vira decorativo:
  // bastaria um call-site passar o objeto errado. Numa ação rara de admin, a
  // segunda leitura é preço justo por uma primitiva que resolve a própria
  // verdade.
  const effective = await getEffectivePermissions(params.userId, params.orgId);
  const withinCeiling = await isWithinRoleCeiling({
    orgId: params.orgId,
    effective,
    targetRole: params.targetRole,
    targetCustomRoleId: params.targetCustomRoleId,
  });
  return withinCeiling
    ? { allowed: true }
    : { allowed: false, reason: "role_ceiling" };
}

/**
 * Permissões que o papel alvo REALMENTE terá, incluindo os overrides de org.
 *
 * Aplicar os overrides importa e o sentido do erro é contraintuitivo:
 * subestimar o alvo torna o teste de subconjunto mais FÁCIL de passar, ou seja
 * erra para o lado PERMISSIVO. Numa org que liberou `CONTRACT_CREATE`/
 * `PROPOSAL_SEND` para gerentes, resolver `gerente` pelo preset base deixaria
 * passar um aprovador que não tem essas chaves — e o convidado entraria com
 * permissão que quem o admitiu nunca teve.
 */
async function resolveTargetPermissions(
  orgId: string,
  targetRole: string,
  customRoleId?: string | null
): Promise<PermissionMap | null> {
  // `custom` só é conhecível COM o id da CustomRole. O fluxo de convite não o
  // carrega (`INVITATION_ROLE_VALUES` não tem `custom`) e cai no `null`, que
  // nega: devolver `{}` ali faria o teto passar VACUAMENTE e liberaria conceder
  // QUALQUER CustomRole da org. Já `POST /api/org/members` aceita
  // `custom` + customRoleId, e negar cego lá tiraria uma capacidade legítima —
  // com o id o alvo é conhecível e o subconjunto é decidível de verdade.
  if (targetRole === "custom") {
    if (!customRoleId) return null;
    const custom = await prisma.customRole.findFirst({
      // Escopado por org: id de OUTRO tenant não vira teto aqui.
      where: { id: customRoleId, orgId },
      select: { permissions: true },
    });
    if (!custom) return null;
    // CustomRole sem permissão nenhuma resolve para `{}` e passa o `.every`
    // vacuamente — e aqui isso está CERTO, ao contrário do caso acima. A
    // vacuidade só é bug quando significa "não sei"; quando significa "sei, e
    // está vazio", conceder é o comportamento correto.
    return resolvePermissions(
      "custom",
      (custom.permissions as PermissionMap | undefined) ?? null
    );
  }

  // Mesma guarda de `getOrgApproverEmails`: `resolvePermissions` faz
  // console.warn em role fora do catálogo, e `member` é o DEFAULT do
  // createInvitationSchema — sem isto toda aprovação comum vira ruído de log.
  // Role desconhecido não concede permissão nenhuma, então `{}` é correto.
  if (!ROLE_PRESETS[targetRole as Exclude<RolePreset, "custom">]) {
    return {};
  }

  let orgOverrides: PermissionMap | null = null;
  if (targetRole === "gerente") {
    const settings = await prisma.orgManagerSettings.findUnique({
      where: { orgId },
      select: { permissionsJson: true },
    });
    const raw = (settings?.permissionsJson ?? {}) as Record<string, unknown>;
    const filtered: PermissionMap = {};
    for (const key of MANAGER_CONFIGURABLE_PERMISSIONS) {
      if (typeof raw[key] === "boolean") filtered[key] = raw[key] as boolean;
    }
    orgOverrides = filtered;
  }

  return resolvePermissions(targetRole as RolePreset, null, orgOverrides);
}

/**
 * E-mails dos membros da org que podem decidir — os que agora recebem o CTA de
 * "aguarda aprovação", já que o botão passou a ser deles. Resolve a permissão
 * em vez de casar `role` na string: uma CustomRole com `org.members.approve`
 * também decide, e um allowlist por role a deixaria de fora.
 *
 * Uma query só, resolvendo o preset em memória — `getEffectivePermissions`
 * daria uma query por membro. Não aplica os overrides de `gerente`
 * (OrgManagerSettings): `org.members.approve` não está em
 * MANAGER_CONFIGURABLE_PERMISSIONS, então gerente nunca a ganha.
 *
 * Ignora membership de serviço (`isSystem`) e usuário em soft delete (LGPD).
 */
export async function getOrgApproverEmails(orgId: string): Promise<string[]> {
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, isSystem: false },
    select: {
      role: true,
      customRole: { select: { permissions: true } },
      user: { select: { email: true, deletedAt: true } },
    },
    // Sem ordem explícita, "os N primeiros" do corte abaixo é a ordem de heap
    // do Postgres, que muda entre chamadas: numa org acima do teto, QUEM é
    // notificado variaria a cada convite, sem nada no log dizendo quem ficou
    // de fora. Os membros mais antigos primeiro é arbitrário, mas estável.
    orderBy: { invitedAt: "asc" },
  });

  const approvers = memberships
    .filter((m) => {
      if (!m.user?.email || m.user.deletedAt !== null) return false;
      // `resolvePermissions` faz console.warn em role fora do catálogo, e
      // `member` — o default de OrgMembership.role E de createInvitationSchema
      // — é justamente um desses. Sem esta guarda, cada criação de convite
      // emitia um warn por membro comum e transformava ação de rotina em spam
      // de log. Role desconhecido não tem permissão nenhuma de qualquer forma.
      if (m.role !== "custom" && !ROLE_PRESETS[m.role as Exclude<RolePreset, "custom">]) {
        return false;
      }
      const permissions = resolvePermissions(
        m.role as RolePreset,
        (m.customRole?.permissions as PermissionMap | undefined) ?? null
      );
      return permissions[PERMISSION.ORG_MEMBERS_APPROVE] === true;
    })
    .map((m) => m.user.email.toLowerCase());

  // Teto no fan-out: cada e-mail é um `sendEmail` em paralelo, e um provedor
  // com rate limit responde a um lote grande derrubando parte dele — sob
  // `Promise.allSettled` isso é falha silenciosa, e o efeito prático é
  // aprovador que não fica sabendo da fila. Truncar é ruim, truncar em
  // silêncio é pior, então avisa.
  if (approvers.length > MAX_APPROVER_NOTIFICATIONS) {
    console.warn(
      `[invitations] org ${orgId} tem ${approvers.length} aprovadores; notificando os ${MAX_APPROVER_NOTIFICATIONS} primeiros`
    );
    return approvers.slice(0, MAX_APPROVER_NOTIFICATIONS);
  }
  return approvers;
}

export function defaultInvitationExpiry(): Date {
  return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Bloqueia criação se já existe convite pendente para o mesmo email/org. */
export async function findPendingInvitation(orgId: string, email: string) {
  return prisma.orgInvitation.findFirst({
    where: { orgId, email: email.toLowerCase(), status: "pending" },
  });
}
