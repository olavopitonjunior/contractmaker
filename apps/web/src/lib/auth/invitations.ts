import { prisma } from "@/lib/db/prisma";

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

export function defaultInvitationExpiry(): Date {
  return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Bloqueia criação se já existe convite pendente para o mesmo email/org. */
export async function findPendingInvitation(orgId: string, email: string) {
  return prisma.orgInvitation.findFirst({
    where: { orgId, email: email.toLowerCase(), status: "pending" },
  });
}
