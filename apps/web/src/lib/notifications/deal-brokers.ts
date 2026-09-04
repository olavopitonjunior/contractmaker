/**
 * Resolvedor de destinatários "corretor" de um deal: comissionados do
 * form.dataJson casados com o registry (SplitRecipient kind="commissioner")
 * + corretores explícitos do override do deal (brokerIds).
 *
 * Diferente do matcher do wizard financeiro, aqui rascunhos INATIVOS
 * (pendingFields) contam — um corretor auto-cadastrado no finalize ainda sem
 * PIX deve receber atualizações do processo. Desativação manual (active=false
 * sem pendingFields) É respeitada como opt-out do registry.
 */

import type { SplitRecipient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  normalizeDoc,
  normalizeName,
  type ComissionadoLike,
} from "@/lib/asaas/commissionados-matcher";

export interface BrokerRecipient {
  splitRecipientId: string;
  label: string;
  email: string | null;
  phone: string | null;
  notifyByEmail: boolean;
  notifyByWhatsapp: boolean;
}

function isEligible(r: SplitRecipient): boolean {
  if (r.kind !== "commissioner") return false;
  if (r.notifyOptOut) return false;
  // Ativo OU rascunho pendente. Desativado "de verdade" fica fora.
  return r.active || (r.pendingFields ?? []).length > 0;
}

function toRecipient(r: SplitRecipient): BrokerRecipient {
  return {
    splitRecipientId: r.id,
    label: r.label,
    email: r.email,
    phone: r.phone,
    notifyByEmail: r.notifyByEmail,
    notifyByWhatsapp: r.notifyByWhatsapp,
  };
}

/**
 * Corretores declarados no dataJson, três listas com o mesmo shape de linha:
 *   - `comissao.comissionados[]` (venda) e `comissao.angariadores[]` (locação)
 *     — a distribuição da comissão. Até 09/2026 só a de venda era lida; o
 *     angariador de locação, auto-cadastrado no finalize, nunca recebia aviso.
 *   - `corretores_parceiros[]` (topo) — corretores PARCEIROS da proposta, que
 *     acompanham por e-mail sem serem comissionados (lib/proposals/
 *     partner-brokers.ts). Chegam ao Deal verbatim pelo convert.
 * Aqui só interessa QUEM avisar; comissão é problema de outro módulo.
 */
function comissionadosOf(formDataJson: unknown): ComissionadoLike[] {
  const data = (formDataJson as Record<string, unknown> | null) ?? {};
  const comissao = data.comissao as Record<string, unknown> | undefined;
  const list = (v: unknown): ComissionadoLike[] =>
    Array.isArray(v) ? (v as ComissionadoLike[]) : [];
  return [
    ...list(comissao?.comissionados),
    ...list(comissao?.angariadores),
    ...list(data.corretores_parceiros),
  ];
}

/** Índices do registry da org — carregados uma vez e reusados por N deals. */
interface RosterIndex {
  byId: Map<string, SplitRecipient>;
  byDoc: Map<string, SplitRecipient>;
  byName: Map<string, SplitRecipient>;
}

function indexRoster(roster: SplitRecipient[]): RosterIndex {
  const byId = new Map(roster.map((r) => [r.id, r]));
  // Mapa por doc preferindo ativos (o dedupe da migration desativou duplicatas
  // — a inativa não pode "roubar" o match da vencedora).
  const byDoc = new Map<string, SplitRecipient>();
  const byName = new Map<string, SplitRecipient>();
  for (const r of [...roster].sort(
    (a, b) => Number(b.active) - Number(a.active)
  )) {
    const doc = normalizeDoc(r.cpfCnpj ?? r.ownerCpfCnpj);
    if (doc.length >= 11 && !byDoc.has(doc)) byDoc.set(doc, r);
    const name = normalizeName(r.label ?? r.ownerName);
    if (name && !byName.has(name)) byName.set(name, r);
  }
  return { byId, byDoc, byName };
}

/**
 * O casamento em si. É a ÚNICA definição de "quem são os corretores deste
 * deal" — as duas direções (deal→corretores e corretor→deals) passam por
 * aqui, e é de propósito: duas regras de match divergentes fariam a rota de
 * escopo do agente conceder um deal que o motor de notificação atribui a
 * outra pessoa.
 */
function pickBrokers(
  idx: RosterIndex,
  comissionados: ComissionadoLike[],
  brokerIds: string[]
): SplitRecipient[] {
  const picked = new Map<string, SplitRecipient>();

  for (const c of comissionados) {
    let match: SplitRecipient | undefined;
    if (c.splitRecipientId) match = idx.byId.get(c.splitRecipientId);
    if (!match) {
      const doc = normalizeDoc(c.cpf || c.cnpj);
      if (doc.length >= 11) match = idx.byDoc.get(doc);
    }
    if (!match) {
      const name = normalizeName(c.nome);
      if (name) match = idx.byName.get(name);
    }
    if (match && isEligible(match)) picked.set(match.id, match);
  }

  for (const id of brokerIds) {
    const r = idx.byId.get(id);
    if (r && isEligible(r)) picked.set(r.id, r);
  }

  return [...picked.values()];
}

export async function resolveDealBrokers(params: {
  orgId: string;
  formDataJson: unknown;
  /** brokerIds explícitos do Deal.notificationsJson (config resolvida). */
  brokerIds: string[];
}): Promise<BrokerRecipient[]> {
  const { orgId, formDataJson, brokerIds } = params;

  const comissionados = comissionadosOf(formDataJson);
  if (comissionados.length === 0 && brokerIds.length === 0) return [];

  // `archivedAt: null` — corretor EXCLUÍDO não recebe aviso de processo.
  // `active` continua de fora de propósito: ele é pagabilidade da esteira de
  // repasse, e um corretor sem chave PIX segue tendo direito a saber que o
  // contrato dele foi assinado. Até 08/2026 os dois sentidos moravam no mesmo
  // booleano e não havia como separar — excluir o cadastro não silenciava nada.
  const roster = await prisma.splitRecipient.findMany({
    where: { orgId, kind: "commissioner", archivedAt: null },
  });

  return pickBrokers(indexRoster(roster), comissionados, brokerIds).map(
    toRecipient
  );
}

/**
 * Direção inversa: de que negócios este corretor participa.
 *
 * Existe para o agente de WhatsApp. Quando um corretor manda mensagem, o
 * telefone diz QUEM ele é; isto diz SOBRE O QUE ele pode falar. Sem a lista,
 * o agente ou não fala de negócio nenhum (inútil) ou fala de todos da org
 * (vazamento) — e a segunda opção é fácil de escrever por engano, porque o
 * corretor É membro legítimo daquele tenant.
 *
 * Implementada RODANDO a resolução direta deal a deal e perguntando se o
 * corretor saiu na lista, em vez de reimplementar o match do outro lado. Custa
 * uma passada em memória por deal e elimina a classe de bug em que o inverso é
 * mais permissivo que o direto — por exemplo, dois recipients com o mesmo nome
 * onde o direto entrega o deal ao ativo e um inverso ingênuo entregaria aos
 * dois.
 *
 * O `limit` é real e o retorno diz quando cortou: o chamador precisa saber a
 * diferença entre "não participa de mais nenhum" e "não olhei além daqui".
 */
export async function resolveBrokerDeals(params: {
  orgId: string;
  splitRecipientId: string;
  limit?: number;
}): Promise<{ dealIds: string[]; scanned: number; truncated: boolean }> {
  const { orgId, splitRecipientId } = params;
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);

  const [roster, deals] = await Promise.all([
    // Mesma regra da direção direta: excluído não participa de negócio nenhum,
    // e é este roster que decide sobre o que o corretor pode falar com o Max.
    prisma.splitRecipient.findMany({
      where: { orgId, kind: "commissioner", archivedAt: null },
    }),
    prisma.deal.findMany({
      where: { pipeline: { orgId } },
      select: {
        id: true,
        notificationsJson: true,
        form: { select: { dataJson: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit + 1,
    }),
  ]);

  const truncated = deals.length > limit;
  const janela = truncated ? deals.slice(0, limit) : deals;
  const idx = indexRoster(roster);

  const dealIds: string[] = [];
  for (const d of janela) {
    const j = d.notificationsJson as { brokerIds?: unknown } | null;
    const brokerIds = Array.isArray(j?.brokerIds)
      ? (j!.brokerIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const comissionados = comissionadosOf(d.form?.dataJson ?? null);
    if (comissionados.length === 0 && brokerIds.length === 0) continue;

    const brokers = pickBrokers(idx, comissionados, brokerIds);
    if (brokers.some((b) => b.id === splitRecipientId)) dealIds.push(d.id);
  }

  return { dealIds, scanned: janela.length, truncated };
}
