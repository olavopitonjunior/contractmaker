import { prisma } from "@/lib/db/prisma";
import {
  normalizeEmail,
  normalizePhone,
  resolveTitularParties,
} from "@/lib/deals/parties";
import type { SurveyRecipientRole } from "./types";

/**
 * Resolve os possíveis destinatários de pesquisa de um deal.
 *
 * As PARTES (vendedor/comprador, locador/locatário — inclusive o fallback
 * relacional de locação) vêm de `lib/deals/parties.ts`, fonte única
 * compartilhada com as notificações do processo. Aqui fica só o que é da
 * pesquisa: o papel `corretor` (`Deal.userId` → User).
 */

export interface SurveyRecipient {
  role: SurveyRecipientRole;
  name: string;
  email: string | null;
  phone: string | null;
}

export { normalizeEmail, normalizePhone };

/** Contato canônico usado no dedupeKey (email > telefone). */
export function recipientContactKey(r: {
  email: string | null;
  phone: string | null;
}): string | null {
  return r.email ?? r.phone;
}

export function buildDedupeKey(args: {
  dealId: string | null;
  templateId: string;
  role: string;
  contact: string;
}): string {
  return `${args.dealId ?? "manual"}:${args.templateId}:${args.role}:${args.contact}`;
}

export interface DealRecipientsResult {
  dealKind: "venda" | "locacao";
  orgId: string;
  recipients: SurveyRecipient[];
}

export async function resolveDealRecipients(
  dealId: string
): Promise<DealRecipientsResult | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      kind: true,
      pipeline: { select: { orgId: true } },
      form: { select: { dataJson: true } },
      // `phone` do corretor: sem ele o canal WhatsApp da pesquisa nunca
      // alcançava quem responde pela imobiliária — caía sempre no fallback
      // de e-mail. Quem não tem telefone cadastrado segue caindo lá.
      user: { select: { name: true, email: true, phone: true } },
    },
  });
  if (!deal) return null;

  const dealKind = deal.kind === "locacao" ? "locacao" : "venda";
  const recipients: SurveyRecipient[] = await resolveTitularParties({
    dealId: deal.id,
    dealKind,
    formDataJson: deal.form?.dataJson ?? null,
  });

  if (deal.user) {
    recipients.push({
      role: "corretor",
      name: deal.user.name ?? "Corretor responsável",
      email: normalizeEmail(deal.user.email),
      phone: normalizePhone(deal.user.phone),
    });
  }

  return { dealKind, orgId: deal.pipeline.orgId, recipients };
}
