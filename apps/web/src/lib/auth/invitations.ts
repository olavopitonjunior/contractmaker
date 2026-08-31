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
 * **Alcance honesto:** isto fecha o caminho de CONVITE, não a org inteira.
 * `POST /api/org/members` cria membership com papel arbitrário protegido só por
 * `org.members.invite` mais `requireElevation`, que hoje é no-op deliberado —
 * quem tem essa chave chega a `admin` por lá, em uma chamada, sem passar por
 * aqui. É pré-existente e fora deste PR; segue como follow-up.
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

  const target = await resolveTargetPermissions(params.orgId, params.targetRole);
  // `null` = papel cujas permissões não dá para conhecer aqui (`custom`, que
  // depende de um customRoleId que este fluxo não carrega). Um mapa vazio
  // passaria o `.every` VACUAMENTE e o teto liberaria conceder qualquer
  // CustomRole da org — nega em vez de adivinhar.
  if (target === null) return { allowed: false, reason: "role_ceiling" };

  const withinCeiling = Object.entries(target).every(
    ([key, granted]) =>
      granted !== true || effective!.permissions[key as PermissionKey] === true
  );
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
  targetRole: string
): Promise<PermissionMap | null> {
  // `custom` não é conhecível sem o customRoleId, que este fluxo não carrega.
  // Devolver `{}` faria o teto passar vacuamente. Hoje é inalcançável pelo
  // convite (`INVITATION_ROLE_VALUES` não tem `custom`), mas a função é
  // exportada e o conserto natural da brecha de `POST /api/org/members` é
  // chamá-la de lá — onde `custom` + customRoleId É aceito.
  if (targetRole === "custom") return null;

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
