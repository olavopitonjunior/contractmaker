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
  // EM ABERTO (produto): desde que cancelar o envelope devolve a proposta pra
  // `falha_envio`, este grupo passou a conter também proposta que SAIU e foi
  // cancelada — cujo badge agora diz "Envio cancelado", não "Falha no envio".
  // O rótulo do chip ficou INCOMPLETO (não errado: falha real continua aqui).
  // Deixado como está de propósito: mudar copy de filtro, ou mover esse recorte
  // pra um chip próprio, é decisão de produto e não conserto de bug. Se for
  // mexer, o discriminador é `isFalhaEnvioAlreadyDelivered` — mas ele depende de
  // `sentAt`, então um chip novo precisaria de `requiresServer: true`, porque
  // `statuses` sozinho não expressa a condição.
  { id: "rascunho", label: "Rascunho / falha", statuses: ["rascunho", "falha_envio", "aguardando_aprovacao"] },
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
