import { prisma } from "@/lib/db/prisma";
import type { ResponsavelOption } from "@/components/pipeline/PipelineFilters";

/**
 * Opções do select "Responsável" do kanban.
 *
 * Antes isto era `user.findMany({ where: { deals: { some: { pipelineId } } } })`
 * — ou seja, só quem já tinha CRIADO um negócio no pipeline. Um gerente que
 * responde por negócios mas nunca criou um simplesmente não existia no filtro
 * (bug reportado na Newcore). A lista agora nasce da MEMBERSHIP da org, unida a
 * quem ainda aparece como criador/gerente de algum negócio do pipeline — senão
 * o negócio de quem saiu da imobiliária ficaria não-filtrável.
 *
 * Ficam de fora dos dois lados: usuário de serviço (`isSystem` — Newton/agentes
 * criam deals com o próprio id, então filtrar só a membership não bastava) e
 * conta removida por LGPD (`deletedAt`, que não anonimiza nome/e-mail).
 *
 * Rótulo — o e-mail só entra como fallback para quem APARECE em negócio, que é
 * a mesma regra do card (`deal-dates.ts`: `manager.name || manager.email`), logo
 * não revela nada que o kanban já não mostre. Membro sem nome e sem negócio é
 * omitido: seria opção de filtro que não casa card nenhum, ao custo de expor um
 * e-mail que nenhuma outra tela dá a um corretor com visão restrita.
 *
 * Não vaza negócio: o escopo RBAC continua no `AND` do `dealWhere`
 * (board-query.ts) — filtrar por um colega fora do escopo devolve zero cards,
 * não os cards dele.
 */
export async function getResponsavelOptions(params: {
  orgId: string;
  pipelineId: string;
}): Promise<ResponsavelOption[]> {
  const { orgId, pipelineId } = params;

  const [memberships, dealPeople] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { orgId, isSystem: false, user: { deletedAt: null } },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    getDealPeople(orgId, pipelineId),
  ]);

  const byId = new Map<string, ResponsavelOption>();

  // Quem tem negócio entra primeiro e pode cair no e-mail — é o rótulo que o
  // card já usa para essa mesma pessoa.
  for (const u of dealPeople) {
    byId.set(u.id, { id: u.id, label: u.name?.trim() || u.email || u.id });
  }
  // Membro sem negócio precisa de nome pra virar opção.
  for (const { user } of memberships) {
    if (byId.has(user.id)) continue;
    const name = user.name?.trim();
    if (!name) continue;
    byId.set(user.id, { id: user.id, label: name });
  }

  return [...byId.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "pt-BR")
  );
}

/**
 * Quem figura como criador ou gerente em algum negócio do pipeline. Dois
 * `groupBy` (só ids) + um `findMany` pelos ids — não varre os deals inteiros.
 *
 * O `findMany` repete os cortes da membership porque esta lista inclui gente
 * SEM membership (ex-membro): sem eles, o usuário de serviço que abre deals via
 * Bearer e a conta apagada por LGPD voltavam pela porta dos fundos.
 */
async function getDealPeople(orgId: string, pipelineId: string) {
  const [creators, managers] = await Promise.all([
    prisma.deal.groupBy({ by: ["userId"], where: { pipelineId } }),
    prisma.deal.groupBy({
      by: ["managerUserId"],
      where: { pipelineId, managerUserId: { not: null } },
    }),
  ]);

  const ids = new Set<string>();
  for (const c of creators) ids.add(c.userId);
  for (const m of managers) if (m.managerUserId) ids.add(m.managerUserId);
  if (ids.size === 0) return [];

  return prisma.user.findMany({
    where: {
      id: { in: [...ids] },
      deletedAt: null,
      orgMemberships: { none: { orgId, isSystem: true } },
    },
    select: { id: true, name: true, email: true },
  });
}
