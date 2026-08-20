/**
 * Opções do filtro de status da lista de propostas — agrupamentos amigáveis ao
 * corretor ("Em aberto", "Com o cliente", …) em vez dos 14 status técnicos.
 * Compartilhado entre a página (resolve o `where`) e o componente de filtros
 * (renderiza o select) pra não divergirem.
 *
 * CLIENT-SAFE (importado por ProposalFilters, "use client") — o filtro que
 * precisa de condição de BANCO além do status ("2ª via falhou" olha envelopes)
 * declara `requiresServer` e é resolvido em list-filters.server.ts.
 */
export interface StatusFilterOption {
  id: string;
  label: string;
  /** null = sem filtro (todos). */
  statuses: string[] | null;
  /** true = o where completo vem de list-filters.server.ts (condição extra). */
  requiresServer?: boolean;
}

export const STATUS_FILTERS: StatusFilterOption[] = [
  { id: "all", label: "Todos os status", statuses: null },
  {
    id: "aberto",
    label: "Em aberto",
    statuses: ["enviada", "entregue", "visualizada", "assinada_proponente", "aguardando_vendedor"],
  },
  // PARTIÇÃO com o chip "Envio cancelado" logo abaixo (decisão de produto,
  // 2026-08-20): a `falha_envio` cujo último desfecho foi cancelamento sai
  // DESTE grupo e entra naquele — os dois wheres são um predicado e sua
  // negação (`sendCanceledWhere`, list-filters.server.ts), então toda
  // falha_envio cai em exatamente UM dos dois, por construção.
  //
  // `statuses` continua listando os 3 de propósito: ele é o PRÉ-FILTRO da
  // busca `q` (raw em page.tsx) e precisa ser SUPERSET do where do servidor —
  // apertá-lo faria a busca esconder resultados que o filtro mostra.
  {
    id: "rascunho",
    label: "Rascunho / falha",
    statuses: ["rascunho", "falha_envio", "aguardando_aprovacao"],
    requiresServer: true,
  },
  // Só a `falha_envio` que o badge âmbar chama de "Envio cancelado". O where
  // (servidor) reproduz o discriminador do BADGE — o último evento de
  // desfecho, via `sendCanceledWhere` — e NÃO `sentAt`, que é a pergunta da
  // exclusão e mostraria uma falha real de reenvio sob este rótulo.
  {
    id: "envio_cancelado",
    label: "Envio cancelado",
    statuses: ["falha_envio"],
    requiresServer: true,
  },
  { id: "cliente", label: "Com o cliente", statuses: ["enviada", "entregue", "visualizada"] },
  // "proprietario" quebrou em dois (2026-08): a parada de decisão é bola do
  // CORRETOR; a 2ª via em curso é bola do proprietário — juntos, o filtro
  // escondia exatamente as propostas que pedem ação.
  { id: "decisao", label: "Aguardando sua decisão", statuses: ["assinada_proponente"] },
  { id: "proprietario", label: "Com o proprietário", statuses: ["aguardando_vendedor"] },
  {
    id: "segunda_via_falhou",
    label: "2ª via falhou",
    statuses: ["aguardando_vendedor"],
    requiresServer: true,
  },
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
