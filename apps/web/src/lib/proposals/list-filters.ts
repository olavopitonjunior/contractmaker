/**
 * Opções do filtro de status da lista de propostas — agrupamentos amigáveis ao
 * corretor ("Em aberto", "Com o cliente", …) em vez dos 14 status técnicos.
 * Compartilhado entre a página (resolve o `where`) e o componente de filtros
 * (renderiza o select) pra não divergirem.
 */
export interface StatusFilterOption {
  id: string;
  label: string;
  /** null = sem filtro (todos). */
  statuses: string[] | null;
}

export const STATUS_FILTERS: StatusFilterOption[] = [
  { id: "all", label: "Todos os status", statuses: null },
  {
    id: "aberto",
    label: "Em aberto",
    statuses: ["enviada", "entregue", "visualizada", "assinada_proponente", "aguardando_vendedor"],
  },
  { id: "rascunho", label: "Rascunho / falha", statuses: ["rascunho", "falha_envio", "aguardando_aprovacao"] },
  { id: "cliente", label: "Com o cliente", statuses: ["enviada", "entregue", "visualizada"] },
  { id: "proprietario", label: "Com o proprietário", statuses: ["assinada_proponente", "aguardando_vendedor"] },
  { id: "concluida", label: "Concluídas", statuses: ["completa", "convertida"] },
  {
    id: "encerrada",
    label: "Encerradas",
    statuses: ["recusada_proponente", "recusada_vendedor", "expirada", "cancelada"],
  },
];

export function statusesForFilter(id: string | undefined | null): string[] | null {
  if (!id) return null;
  const f = STATUS_FILTERS.find((x) => x.id === id);
  return f ? f.statuses : null;
}
