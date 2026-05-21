/**
 * Auto-derivação do vínculo deal↔grupo de WhatsApp.
 *
 * Cruza os telefones das partes-cliente do deal (vendedores/compradores) com os
 * membros observados dos grupos (`WhatsappGroupMember`, sincronizados do sidecar),
 * EXCLUINDO os telefones de operadores da org (negociador etc., que estão em vários
 * grupos e poluiriam o match). Match forte → grava `DealGroupLink`; senão devolve os
 * grupos candidatos para a UI escolher.
 *
 * Limitação: membership é "observada" (quem já falou no grupo). Por isso o match é
 * idempotente — roda na criação, em atividade de grupo e no sweep, e amadurece.
 */
import { prisma } from "@/lib/db/prisma";

/** Normaliza para dígitos com DDI 55 (BR). Reconcilia mobile_phone (Contractmaker)
 *  com participant_phone Z-API (E.164 sem '+'). Retorna null se inválido. */
export function normalizePhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.startsWith("55") && d.length >= 12) return d; // já tem 55 + DDD + número
  if (d.length === 10 || d.length === 11) return "55" + d; // DDD + número
  return d; // fallback (mantém como veio)
}

/** Sufixo comparável (últimos 8 dígitos) — tolera ausência/ presença do 9º dígito. */
function suffix8(phone: string): string {
  return phone.slice(-8);
}

interface DealWithParties {
  id: string;
  userId: string;
  form: { dataJson: unknown } | null;
  dataJson: unknown;
  fromLead: { phones: string[] } | null;
}

/** Extrai telefones das partes-cliente do deal (vendedores + compradores + lead). */
export function extractPartyPhones(deal: DealWithParties): string[] {
  const out: string[] = [];
  const data =
    (deal.form?.dataJson as Record<string, unknown> | null) ??
    (deal.dataJson as Record<string, unknown> | null) ??
    {};
  for (const key of ["vendedores", "compradores"]) {
    const arr = (data as Record<string, unknown>)[key];
    if (Array.isArray(arr)) {
      for (const p of arr) {
        const ph = (p as Record<string, unknown>)?.mobile_phone;
        const n = normalizePhone(ph);
        if (n) out.push(n);
      }
    }
  }
  for (const ph of deal.fromLead?.phones ?? []) {
    const n = normalizePhone(ph);
    if (n) out.push(n);
  }
  return Array.from(new Set(out));
}

export interface GroupCandidate {
  groupId: string;
  name: string | null;
  hits: number;
}

export interface MatchResult {
  linked: boolean;
  groupId?: string;
  candidates: GroupCandidate[];
}

const STRONG_MIN_HITS = 2;

export interface CandidatesResult {
  orgId: string;
  existingGroupId: string | null;
  candidates: GroupCandidate[];
  /** top único com hits ≥ STRONG_MIN_HITS */
  strong: boolean;
}

/**
 * Computa os grupos candidatos para um deal (PURO — não grava nada). Usado pela UI
 * (GET group-candidates) e pelo matchDealGroup (que decide gravar).
 */
export async function computeDealGroupCandidates(
  dealId: string
): Promise<CandidatesResult | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true, dataJson: true } },
      pipeline: { select: { orgId: true } },
      fromLead: { select: { phones: true } },
    },
  });
  if (!deal) return null;

  const orgId = deal.form?.orgId ?? deal.pipeline.orgId;

  const existing = await prisma.dealGroupLink.findUnique({ where: { dealId } });
  if (existing) {
    return { orgId, existingGroupId: existing.groupId, candidates: [], strong: false };
  }

  // Telefones de operadores da org (corp) — excluídos do sinal de match.
  const orgUsers = await prisma.orgMembership.findMany({
    where: { orgId },
    select: { user: { select: { phone: true } } },
  });
  const negotiator = await prisma.user.findUnique({
    where: { id: deal.userId },
    select: { phone: true },
  });
  const excluded = new Set<string>();
  for (const m of orgUsers) {
    const n = normalizePhone(m.user.phone);
    if (n) excluded.add(suffix8(n));
  }
  const negN = normalizePhone(negotiator?.phone);
  if (negN) excluded.add(suffix8(negN));

  const partyPhones = extractPartyPhones(deal as DealWithParties).filter(
    (p) => !excluded.has(suffix8(p))
  );
  if (partyPhones.length === 0) {
    return { orgId, existingGroupId: null, candidates: [], strong: false };
  }

  const partySuffixes = partyPhones.map(suffix8);

  // Membros (da org) cujo telefone bate (por sufixo) com alguma parte-cliente.
  const members = await prisma.whatsappGroupMember.findMany({
    where: { group: { orgId }, phone: { in: partyPhones } },
    select: { phone: true, group: { select: { groupId: true, name: true } } },
  });
  // Fallback por sufixo (tolera 9º dígito): puxa membros da org e compara sufixo.
  const tally = new Map<string, { name: string | null; phones: Set<string> }>();
  const addHit = (groupId: string, name: string | null, phone: string) => {
    const e = tally.get(groupId) ?? { name, phones: new Set<string>() };
    e.phones.add(suffix8(phone));
    e.name = e.name ?? name;
    tally.set(groupId, e);
  };
  for (const m of members) addHit(m.group.groupId, m.group.name, m.phone);

  // Se o IN exato achou pouco, complementa por sufixo (cobre divergência de 9º dígito).
  if (members.length === 0) {
    const orgMembers = await prisma.whatsappGroupMember.findMany({
      where: { group: { orgId } },
      select: { phone: true, group: { select: { groupId: true, name: true } } },
    });
    for (const m of orgMembers) {
      if (partySuffixes.includes(suffix8(m.phone))) {
        addHit(m.group.groupId, m.group.name, m.phone);
      }
    }
  }

  const candidates: GroupCandidate[] = Array.from(tally.entries())
    .map(([groupId, e]) => ({ groupId, name: e.name, hits: e.phones.size }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5);

  const top = candidates[0];
  const tiedAtTop = !!top && candidates.filter((c) => c.hits === top.hits).length > 1;
  const strong = !!top && top.hits >= STRONG_MIN_HITS && !tiedAtTop;

  return { orgId, existingGroupId: null, candidates, strong };
}

/**
 * Roda o match e GRAVA o `DealGroupLink` se o match for forte (top único com
 * ≥2 telefones-cliente). Idempotente: se já houver link, não mexe. Senão devolve
 * candidatos para a UI escolher. Chamado na criação do deal, em atividade de
 * grupo e no sweep.
 */
export async function matchDealGroup(dealId: string): Promise<MatchResult> {
  const r = await computeDealGroupCandidates(dealId);
  if (!r) return { linked: false, candidates: [] };
  if (r.existingGroupId) return { linked: true, groupId: r.existingGroupId, candidates: [] };

  if (r.strong) {
    const top = r.candidates[0];
    await prisma.dealGroupLink.upsert({
      where: { dealId },
      create: {
        orgId: r.orgId,
        dealId,
        groupId: top.groupId,
        groupLabel: top.name ?? null,
        confirmedBy: "newton-automatch",
      },
      update: { groupId: top.groupId, groupLabel: top.name ?? null },
    });
    return { linked: true, groupId: top.groupId, candidates: r.candidates };
  }

  return { linked: false, candidates: r.candidates };
}
