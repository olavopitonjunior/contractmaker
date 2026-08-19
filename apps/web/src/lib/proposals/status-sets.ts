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
 * (não inclui os terminais).
 *
 * `falha_envio` ENTROU (2026-08): antes ficava de fora porque só se chegava lá
 * por claim de envio que nunca saiu — proposta que ninguém viu, cujo desfecho
 * natural é excluir (`DELETABLE_STATUSES`). Desde que cancelar o envelope
 * devolve a 1ª via pra cá, `falha_envio` também cobre proposta REALMENTE
 * enviada, que o cliente viu, e essa não se exclui: se o negócio morreu, o
 * corretor precisa ARQUIVAR o registro. Sem isto, cancelar o envelope tirava o
 * botão "Cancelar proposta" que existia em `enviada`, e a única saída terminal
 * virava apagar a proposta.
 */
export const CANCELLABLE_STATUSES = new Set<string>([
  "rascunho",
  "aguardando_aprovacao",
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
  "falha_envio",
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
 * Convertível em negócio com 1 clique — SÓ `completa`: é o único status que
 * `convertProposalToDeal` aceita como assinado (`signed = status === "completa"`,
 * que exige o dossiê pronto). Incluir os parciais aqui fazia o botão "Converter
 * em negócio" tomar 400 `not_completa` — eles convertem pelo caminho com motivo
 * (`CONVERT_UNSIGNED_STATUSES`), que é o que o servidor aceita sem dossiê.
 */
export const CONVERTABLE_STATUSES = new Set<string>(["completa"]);

/** Convertível SEM assinatura completa (com motivo obrigatório). */
export const CONVERT_UNSIGNED_STATUSES = new Set<string>([
  "rascunho",
  "enviada",
  "entregue",
  "visualizada",
  "assinada_proponente",
  "aguardando_vendedor",
]);

/**
 * Statuses que o cron de expiração realmente expira (espelha
 * `ALLOWED_FROM.expirada`). Base do KPI "Expirando" — prometer expiração de um
 * status que o cron nunca expira (parciais assinados) era mentira do card.
 */
export const EXPIRABLE_STATUSES = new Set<string>([
  "enviada",
  "entregue",
  "visualizada",
]);

/**
 * Assinatura iniciada ou concluída — o prazo de aceite deixa de correr: o
 * proponente já se manifestou dentro da validade, então "vencida" seria falso.
 * Base do `proposalDeadline` (coluna Prazo, detalhe e landing pública).
 */
export const SIGNED_OR_LATER_STATUSES = new Set<string>([
  "assinada_proponente",
  "aguardando_vendedor",
  "completa",
  "convertida",
]);

/**
 * KPI "Assinadas/Convertidas": proposta assinada por todos (`completa`) conta
 * como conversão mesmo antes do clique "Converter em negócio".
 */
export const CONVERSION_KPI_STATUSES = new Set<string>([
  "completa",
  "convertida",
]);
