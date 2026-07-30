/**
 * Conjuntos de status que gateiam AÇÕES da proposta — fonte ÚNICA usada tanto
 * pelas rotas (guard do servidor) quanto pelos componentes (mostra/esconde
 * botão). Antes viviam triplicados (server + 2 clients) e divergiam (botão morto
 * ou 409). Client-safe (sem import de prisma). O guard final de transição
 * continua no CAS de `advanceProposalStatus`; estes só evitam oferecer o que a
 * API rejeitaria.
 */

/**
 * EDITÁVEL — a proposta ainda não saiu, então mexer no conteúdo é seguro.
 *
 * É EXATAMENTE o mesmo conjunto do claim atômico de envio em
 * `executeProposalSend` (`status: { in: [...] }`): tudo que pode virar "enviada"
 * pode ser editado antes; nada depois. Divergir os dois abriria a janela de
 * editar o documento entre o claim e o congelamento do `sentSnapshotHtml`.
 *
 * Gateia: PATCH /api/proposals/[id], POST .../preview, a página /editar e o
 * botão "Editar proposta" no detalhe.
 */
export const EDITABLE_STATUSES = new Set<string>([
  "rascunho",
  "aguardando_aprovacao",
  "falha_envio",
]);

/** Terminais (nenhuma ação de progressão). Espelha `isTerminal` em status.ts. */
export const TERMINAL_STATUSES = new Set<string>([
  "convertida",
  "recusada_proponente",
  "recusada_vendedor",
  "expirada",
  "cancelada",
  "completa",
]);

/**
 * De onde `cancelar` é válido — espelha `ALLOWED_FROM.cancelada` em status.ts
 * (NÃO inclui `falha_envio`, que não é predecessor válido, nem os terminais).
 */
export const CANCELLABLE_STATUSES = new Set<string>([
  "rascunho",
  "aguardando_aprovacao",
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
]);

/** Estados FRIOS (sem envelope/aceite ativo) onde excluir é seguro. */
export const DELETABLE_STATUSES = new Set<string>([
  "rascunho",
  "falha_envio",
  "cancelada",
  "expirada",
  "recusada_proponente",
  "recusada_vendedor",
]);

/**
 * Assinatura EM CURSO — o polling em tempo real deve continuar mesmo quando não
 * há envelope `running` naquele instante. Cobre a janela entre o envelope dos
 * proponentes fechar (assinada_proponente/aguardando_vendedor) e o 2º envelope do
 * vendedor ser criado — sem isto o poller parava e a página ficava presa.
 */
export const AWAITING_SIGNATURE_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
]);

/**
 * "Em aberto" — proposta enviada e ainda em curso (nem terminal nem rascunho).
 * Base dos KPIs da lista e do polling de tempo real. Fonte única (server + client).
 */
export const OPEN_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
]);

/** Aguardando cliente/proprietário — faz sentido lembrar/reenviar. */
export const REMINDABLE_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
]);

/** Convertível em negócio (assinatura concluída o suficiente). */
export const CONVERTABLE_STATUSES = new Set<string>([
  "completa",
  "assinada_proponente",
  "aguardando_vendedor",
]);

/** Convertível SEM assinatura (com motivo). */
export const CONVERT_UNSIGNED_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
  "rascunho",
]);
