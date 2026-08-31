import { prisma } from "@/lib/db/prisma";
import { can, getEffectivePermissions } from "@/lib/security/rbac/check";
import { PERMISSION, type PermissionMap } from "@/lib/security/rbac/permissions";
import { resolvePermissions, type RolePreset } from "@/lib/security/rbac/roles";

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
export async function canApproveInvitations(params: {
  userId: string;
  orgId: string;
  email?: string | null;
  /** E-mail do admin real sob impersonation (`ctx.impersonatedByEmail`). */
  impersonatedByEmail?: string | null;
}): Promise<boolean> {
  // O ator humano é o impersonador quando há um; só ele faz sentido contra uma
  // allowlist de operador de plataforma.
  if (isApprover(params.impersonatedByEmail ?? params.email)) return true;
  const effective = await getEffectivePermissions(params.userId, params.orgId);
  return can(effective, PERMISSION.ORG_MEMBERS_APPROVE);
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
  });

  return memberships
    .filter((m) => {
      if (!m.user?.email || m.user.deletedAt !== null) return false;
      const permissions = resolvePermissions(
        m.role as RolePreset,
        (m.customRole?.permissions as PermissionMap | undefined) ?? null
      );
      return permissions[PERMISSION.ORG_MEMBERS_APPROVE] === true;
    })
    .map((m) => m.user.email.toLowerCase());
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
