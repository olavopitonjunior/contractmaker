/**
 * Partes TITULARES de um negócio (vendedor/comprador, locador/locatário) — a
 * fonte única de "quem é o cliente deste deal", compartilhada pelas pesquisas
 * de satisfação (lib/surveys/recipients.ts) e pelas notificações do processo
 * (lib/notifications/deal-parties.ts).
 *
 * Nasceu extraído de lib/surveys/recipients.ts quando o público `party` entrou
 * nas notificações: duas leituras do mesmo `dataJson` divergiriam com o tempo
 * (o form já mudou `telefone` → `mobile_phone` uma vez).
 *
 * Restrição: SÓ titulares. Sub-partes (cônjuges, representantes, procuradores)
 * ficam de fora — quem recebe aviso de processo é quem assina o negócio.
 */

import { prisma } from "@/lib/db/prisma";

export const DEAL_PARTY_ROLES = [
  "vendedor",
  "comprador",
  "locador",
  "locatario",
] as const;

export type DealPartyRole = (typeof DEAL_PARTY_ROLES)[number];

export interface DealParty {
  role: DealPartyRole;
  name: string;
  email: string | null;
  phone: string | null;
}

interface PartyLike {
  nome?: string;
  razao_social?: string;
  email?: string;
  // O form de vendas usa `mobile_phone` (canônico); `telefone` é legado —
  // mesma ordem de fallback do clicksign/mapping.ts (`mobile_phone ?? telefone`).
  mobile_phone?: string;
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

export function partiesFromFormList(
  parties: unknown,
  role: DealPartyRole
): DealParty[] {
  if (!Array.isArray(parties)) return [];
  const out: DealParty[] = [];
  for (const raw of parties as PartyLike[]) {
    const name = (raw?.nome ?? raw?.razao_social ?? "").trim();
    const email = normalizeEmail(raw?.email);
    const phone = normalizePhone(raw?.mobile_phone || raw?.telefone);
    if (!name && !email && !phone) continue;
    out.push({ role, name: name || "(sem nome)", email, phone });
  }
  return out;
}

/** Parte fundida em outra pelo dedupe — rastro pro log de notificações. */
export interface DroppedParty {
  nome: string;
  role: DealPartyRole;
  /** Por que caiu: contato idêntico ao de outra parte, ou mesmo nome sem contato. */
  reason: "email_duplicado" | "telefone_duplicado" | "nome_duplicado_sem_contato";
  /** Nome da parte que ABSORVEU esta (a primeira ocorrência). */
  mergedInto: string;
}

/**
 * Funde entradas que compartilham e-mail OU telefone — a MESMA pessoa aparece
 * duas vezes com frequência (titular listado como vendedor e como locador num
 * deal convertido, ou o mesmo contato repetido no form). Sem isto a pessoa
 * receberia o aviso duas vezes: o dedupe do log é por `recipientKey`, e duas
 * linhas com contatos parcialmente preenchidos gerariam chaves diferentes.
 *
 * A primeira ocorrência manda no papel e no nome; a segunda só completa
 * contato faltante.
 *
 * `dropped` existe porque a fusão é AGRESSIVA por desenho: duas pessoas
 * DIFERENTES que compartilham o telefone da família (ou o e-mail do casal) viram
 * uma só, e a que sumiu não recebe nada. Sem rastro, "o comprador não foi
 * avisado" era indistinguível de um bug de envio. Não muda o comportamento de
 * envio — só o torna auditável (ver `notifyDealEvent`).
 */
export function dedupeParties(parties: DealParty[]): {
  parties: DealParty[];
  dropped: DroppedParty[];
} {
  const out: DealParty[] = [];
  const dropped: DroppedParty[] = [];
  for (const p of parties) {
    let reason: DroppedParty["reason"] | null = null;
    const hit = out.find((q) => {
      if (p.email !== null && q.email === p.email) {
        reason = "email_duplicado";
        return true;
      }
      if (p.phone !== null && q.phone === p.phone) {
        reason = "telefone_duplicado";
        return true;
      }
      if (
        p.email === null &&
        p.phone === null &&
        q.name.toLowerCase() === p.name.toLowerCase()
      ) {
        reason = "nome_duplicado_sem_contato";
        return true;
      }
      return false;
    });
    if (hit) {
      dropped.push({
        nome: p.name,
        role: p.role,
        reason: reason ?? "nome_duplicado_sem_contato",
        mergedInto: hit.name,
      });
      hit.email ??= p.email;
      hit.phone ??= p.phone;
      continue;
    }
    out.push({ ...p });
  }
  return { parties: out, dropped };
}

/**
 * Titulares do deal a partir do form, com fallback relacional de locação:
 * deal já convertido em contrato de administração tem as partes como entidades
 * (LeaseTenant→Tenant, PropertyOwnership→PropertyOwner), não só no `dataJson`.
 *
 * O fallback só entra quando o form não deu NENHUMA parte — mesma semântica de
 * antes da extração.
 */
export async function resolveTitularParties(params: {
  dealId: string;
  dealKind: "venda" | "locacao";
  formDataJson: unknown;
}): Promise<DealParty[]> {
  const { dealId, dealKind, formDataJson } = params;
  const data = (formDataJson as Record<string, unknown> | null) ?? {};
  const parties: DealParty[] = [];

  if (dealKind === "venda") {
    parties.push(...partiesFromFormList(data.vendedores, "vendedor"));
    parties.push(...partiesFromFormList(data.compradores, "comprador"));
    return parties;
  }

  parties.push(...partiesFromFormList(data.locadores, "locador"));
  parties.push(...partiesFromFormList(data.locatarios, "locatario"));
  if (parties.length > 0) return parties;

  const lease = await prisma.leaseContract.findFirst({
    where: { dealId },
    select: {
      tenants: {
        select: { tenant: { select: { nome: true, email: true, phone: true } } },
      },
      property: {
        select: {
          ownerships: {
            select: { owner: { select: { nome: true, email: true, phone: true } } },
          },
        },
      },
    },
  });

  for (const lt of lease?.tenants ?? []) {
    parties.push({
      role: "locatario",
      name: lt.tenant.nome,
      email: normalizeEmail(lt.tenant.email),
      phone: normalizePhone(lt.tenant.phone),
    });
  }
  for (const ownership of lease?.property?.ownerships ?? []) {
    parties.push({
      role: "locador",
      name: ownership.owner.nome,
      email: normalizeEmail(ownership.owner.email),
      phone: normalizePhone(ownership.owner.phone),
    });
  }
  return parties;
}
