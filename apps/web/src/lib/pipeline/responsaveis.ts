import { prisma } from "@/lib/db/prisma";
import type { ResponsavelOption } from "@/components/pipeline/PipelineFilters";

/**
 * Opções do select "Responsável" do kanban.
 *
 * Antes isto era `user.findMany({ where: { deals: { some: { pipelineId } } } })`
 * — ou seja, só quem já tinha CRIADO um negócio no pipeline. Um gerente que
 * responde por negócios mas nunca criou um simplesmente não existia no filtro
 * (bug reportado na Newcore). A lista agora nasce da MEMBERSHIP da org, igual à
 * tela de Propostas (app/(dashboard)/pipeline/propostas/page.tsx), unida a quem
 * ainda aparece como criador/gerente de algum negócio do pipeline — senão o
 * negócio de quem saiu da imobiliária ficaria não-filtrável.
 *
 * `isSystem` fica de fora: são usuários de serviço (Newton/agentes), não gente.
 *
 * Exposição — decisão consciente: quem abre o kanban passa a ver nome (e
 * e-mail, quando não há nome) de TODOS os colegas da própria org, inclusive
 * corretor com `DEAL_VIEW_ASSIGNED_ONLY`. É o mesmo dado que
 * `/api/deals/manager-context` já devolve a qualquer membro autenticado, e a
 * tela de Propostas já lista a membership inteira. Não vaza negócio: o escopo
 * RBAC continua no `AND` do `dealWhere` (board-query.ts) — filtrar por um
 * colega fora do escopo devolve zero cards, não os cards dele.
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
    getDealPeople(pipelineId),
  ]);

  const byId = new Map<string, ResponsavelOption>();
  const add = (u: { id: string; name: string | null; email: string | null }) => {
    if (byId.has(u.id)) return;
    byId.set(u.id, { id: u.id, label: u.name?.trim() || u.email || u.id });
  };
  for (const m of memberships) add(m.user);
  for (const u of dealPeople) add(u);

  return [...byId.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "pt-BR")
  );
}

/**
 * Quem figura como criador ou gerente em algum negócio do pipeline. Dois
 * `groupBy` (só ids) + um `findMany` pelos ids — não varre os deals inteiros.
 */
async function getDealPeople(pipelineId: string) {
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
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, email: true },
  });
}
