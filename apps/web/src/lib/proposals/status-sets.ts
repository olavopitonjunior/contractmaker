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
 * Assinatura EM CURSO — alguém de fora ainda precisa assinar.
 *
 * `assinada_proponente` SAIU (2026-08): ele virou a PARADA DURÁVEL da decisão
 * humana (enviar 2ª via ao proprietário ou concluir sem enviar) — não há
 * assinatura pendente ali, há decisão do corretor. `aguardando_vendedor` fica:
 * cobre a janela entre criar e ativar o 2º envelope.
 */
export const AWAITING_SIGNATURE_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
  "aguardando_vendedor",
]);

/**
 * Polling em TEMPO REAL (3-10s) — só onde um evento externo (cliente/
 * proprietário assinando) pode chegar a qualquer momento. A parada de decisão
 * (`assinada_proponente`) fica de fora de propósito: é durável (pode ficar dias)
 * e mantê-la no poller vira carga eterna no Neon sem informação nova.
 */
export const LIVE_POLL_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
  "aguardando_vendedor",
]);

/**
 * De onde "enviar ao proprietário/vendedor" é válido: na parada de decisão
 * (caminho feliz) e em `aguardando_vendedor` (retry manual quando a 2ª via
 * falhou em criar envelope — sem isto a proposta ficava presa sem botão).
 */
export const SEND_VENDEDOR_STATUSES = new Set<string>([
  "assinada_proponente",
  "aguardando_vendedor",
]);

/** Parada durável de decisão humana — a UI mostra o card "sua vez". */
export const AWAITING_DECISION_STATUSES = new Set<string>(["assinada_proponente"]);

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

/**
 * Convertível em negócio DIRETO (sem motivo). Só `completa`: o executor
 * (`convertProposalToDeal`) sempre exigiu `status === "completa"` pra conversão
 * assinada — oferecer o botão em assinada_proponente/aguardando_vendedor dava
 * 400 na hora do clique (bug A do plano 2026-08-06).
 */
export const CONVERTABLE_STATUSES = new Set<string>(["completa"]);

/**
 * Convertível SEM assinatura completa (com motivo obrigatório). Inclui a parada
 * de decisão e aguardando_vendedor: o proponente já assinou, mas o executor
 * trata como `convertedWithoutSignature` — a UI pede o motivo e segue.
 */
export const CONVERT_UNSIGNED_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
  "rascunho",
  "assinada_proponente",
  "aguardando_vendedor",
]);
