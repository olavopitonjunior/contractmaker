import { prisma } from "@/lib/db/prisma";

/**
 * Política de capabilities do Max — a metade daqui de um contrato de dois repos.
 *
 * ── O que ela decide, e o que ela não decide ──────────────────────────────
 *
 * Decide o teto do que o agente pode OFERECER. **Não** decide quais linhas
 * voltam: isso é `dealScopeWhere`/`proposalScopeWhere` (`lib/security/rbac`),
 * que roda no servidor e que esta política não alcança. Se o escopo daquele
 * gerente não enxerga o negócio, nenhuma configuração aqui o faz aparecer.
 *
 * As duas travas são independentes de propósito: esta é configuração de tenant,
 * aquela é autorização de plataforma. A política **nunca alarga** — só estreita
 * o que o RBAC já permitiu. É a regra 5 da governança do Max lida de trás para
 * frente: o que o modelo nunca recebe, ele não pode vazar.
 *
 * ── Fail-closed, e o mesmo silêncio dos dois lados ────────────────────────
 *
 * Org sem linha e org com linha vazia significam a MESMA coisa: nenhuma
 * capability (regra 3 do `CLAUDE.md`). Não existe estado "não configurado" que
 * conceda algo por omissão, e é por isso que a leitura devolve a forma vazia em
 * vez de `null` — quem consome não precisa distinguir dois casos que têm a
 * mesma resposta.
 *
 * ── Capability desconhecida é ignorada, nunca erro ────────────────────────
 *
 * Este repo NÃO valida nome de capability contra um catálogo próprio, e isso é
 * deliberado: o catálogo canônico vive em `max-agent/src/graph/policy.ts`, e
 * duplicá-lo aqui criaria duas listas para divergir. Um nome que o Max não
 * conhece é descartado por ele na leitura. Rejeitar aqui obrigaria um deploy
 * coordenado a cada capability nova — exatamente o acoplamento que a regra 2
 * (receptor primeiro, inerte) existe para evitar.
 */

export interface MaxPolicyDTO {
  /** `{ [rolePreset]: Capability[] }` — papel ausente = nenhuma. */
  byRole: Record<string, string[]>;
  /** `{ [splitRecipientId]: { allow?, deny? } }` — `deny` vence `allow`. */
  byRecipient: Record<string, { allow?: string[]; deny?: string[] }>;
  /** Corretor comissionado sem override. */
  brokerDefault: string[];
}

/** A forma que toda org tem antes de alguém configurar qualquer coisa. */
export const POLITICA_VAZIA: MaxPolicyDTO = Object.freeze({
  byRole: {},
  byRecipient: {},
  brokerDefault: [],
});

/**
 * Json do Prisma é `unknown` na prática — a coluna aceita qualquer forma, e uma
 * linha gravada por uma versão anterior (ou à mão) não pode derrubar o turn.
 * Forma inesperada vira o vazio, que é o lado seguro.
 */
function objetoDeListas(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(val)) out[k] = val.filter((x): x is string => typeof x === "string");
  }
  return out;
}

function listaDeStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function overrides(v: unknown): MaxPolicyDTO["byRecipient"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: MaxPolicyDTO["byRecipient"] = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as { allow?: unknown; deny?: unknown };
    const allow = listaDeStrings(o.allow);
    const deny = listaDeStrings(o.deny);
    if (allow.length || deny.length) out[k] = { ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) };
  }
  return out;
}

/**
 * A política desta org, sempre numa forma válida.
 *
 * Falha de leitura **não** derruba quem chama: cai no vazio, que é fail-closed.
 * Ficar sem política é conceder nada; ficar sem resposta seria derrubar o turn
 * do agente por causa de uma configuração que quase sempre está vazia.
 */
export async function getMaxPolicy(orgId: string): Promise<MaxPolicyDTO> {
  try {
    const row = await prisma.maxCapabilityPolicy.findUnique({
      where: { orgId },
      select: { byRole: true, byRecipient: true, brokerDefault: true },
    });
    if (!row) return POLITICA_VAZIA;
    return {
      byRole: objetoDeListas(row.byRole),
      byRecipient: overrides(row.byRecipient),
      brokerDefault: listaDeStrings(row.brokerDefault),
    };
  } catch (err) {
    console.warn(
      "[max/policy] leitura falhou, seguindo fail-closed:",
      err instanceof Error ? err.message : String(err)
    );
    return POLITICA_VAZIA;
  }
}

/**
 * Grava a política da org. Upsert porque a ausência da linha é um estado
 * legítimo — a primeira edição de um tenant é sempre um insert.
 */
export async function setMaxPolicy(
  orgId: string,
  politica: MaxPolicyDTO,
  updatedBy: string | null
): Promise<MaxPolicyDTO> {
  const dados = {
    byRole: objetoDeListas(politica.byRole),
    byRecipient: overrides(politica.byRecipient),
    brokerDefault: listaDeStrings(politica.brokerDefault),
  };
  await prisma.maxCapabilityPolicy.upsert({
    where: { orgId },
    create: { orgId, ...dados, updatedBy },
    update: { ...dados, updatedBy },
  });
  return dados;
}
