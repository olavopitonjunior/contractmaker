import { prisma } from "@/lib/db/prisma";
import type { SurveyRecipientRole } from "./types";

/**
 * Resolve os possíveis destinatários de pesquisa de um deal.
 *
 * Vendas: partes em `SalesForm.dataJson.vendedores[]/compradores[]` (shape do
 * form público — nome/razao_social, email, telefone). Locação: mesmas listas
 * em `locadores[]/locatarios[]`, com fallback relacional via LeaseContract
 * (LeaseTenant→Tenant, PropertyOwnership→PropertyOwner) pra deals que já
 * viraram contrato de administração. Corretor: `Deal.userId` → User.
 */

export interface SurveyRecipient {
  role: SurveyRecipientRole;
  name: string;
  email: string | null;
  phone: string | null;
}

interface PartyLike {
  nome?: string;
  razao_social?: string;
  email?: string;
  telefone?: string;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

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

function fromParties(
  parties: unknown,
  role: SurveyRecipientRole
): SurveyRecipient[] {
  if (!Array.isArray(parties)) return [];
  const out: SurveyRecipient[] = [];
  for (const raw of parties as PartyLike[]) {
    const name = (raw?.nome ?? raw?.razao_social ?? "").trim();
    const email = normalizeEmail(raw?.email);
    const phone = normalizePhone(raw?.telefone);
    if (!name && !email && !phone) continue;
    out.push({ role, name: name || "(sem nome)", email, phone });
  }
  return out;
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
      user: { select: { name: true, email: true } },
    },
  });
  if (!deal) return null;

  const dealKind = deal.kind === "locacao" ? "locacao" : "venda";
  const dataJson = (deal.form?.dataJson ?? {}) as Record<string, unknown>;
  const recipients: SurveyRecipient[] = [];

  if (dealKind === "venda") {
    recipients.push(...fromParties(dataJson.vendedores, "vendedor"));
    recipients.push(...fromParties(dataJson.compradores, "comprador"));
  } else {
    recipients.push(...fromParties(dataJson.locadores, "locador"));
    recipients.push(...fromParties(dataJson.locatarios, "locatario"));

    // Fallback relacional: deal já convertido em contrato de locação tem as
    // partes como entidades (Tenant/PropertyOwner), não só no form.
    if (recipients.length === 0) {
      const lease = await prisma.leaseContract.findFirst({
        where: { dealId: deal.id },
        select: {
          tenants: {
            select: {
              tenant: { select: { nome: true, email: true, phone: true } },
            },
          },
          property: {
            select: {
              ownerships: {
                select: {
                  owner: { select: { nome: true, email: true, phone: true } },
                },
              },
            },
          },
        },
      });
      for (const lt of lease?.tenants ?? []) {
        recipients.push({
          role: "locatario",
          name: lt.tenant.nome,
          email: normalizeEmail(lt.tenant.email),
          phone: normalizePhone(lt.tenant.phone),
        });
      }
      for (const ownership of lease?.property?.ownerships ?? []) {
        recipients.push({
          role: "locador",
          name: ownership.owner.nome,
          email: normalizeEmail(ownership.owner.email),
          phone: normalizePhone(ownership.owner.phone),
        });
      }
    }
  }

  if (deal.user) {
    recipients.push({
      role: "corretor",
      name: deal.user.name ?? "Corretor responsável",
      email: normalizeEmail(deal.user.email),
      phone: null,
    });
  }

  return { dealKind, orgId: deal.pipeline.orgId, recipients };
}
