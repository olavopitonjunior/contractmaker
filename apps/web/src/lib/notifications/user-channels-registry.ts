/**
 * Allowlist EXPLÍCITA de quais tipos de Notification podem sair em canal
 * externo (WhatsApp ou e-mail) pro usuário da plataforma: em que categoria
 * cada um cai, e como ele se chama na tela de configuração.
 *
 * Regra: tipo que não está aqui NÃO tem canal externo nenhum. Um tipo novo
 * nasce sem WhatsApp até alguém deliberadamente listá-lo — o oposto de
 * "engancha em tudo que passa pelo sino".
 *
 * Os tipos vêm de: lib/notifications/deal-events.ts (`deal_*` +
 * `form_completed`), lib/clicksign/notify-envelope.ts, lib/proposals/
 * notify-proposal.ts, lib/financeiro/notifications.ts, lib/certidoes/
 * executor.ts, lib/ai/budget.ts e chamadas soltas de emitNotification.
 *
 * FORA nesta rodada, por decisão de produto: `survey_response` e
 * `survey_detractor` (pesquisas de satisfação). O sino e o e-mail de detrator
 * seguem funcionando — só não há WhatsApp.
 */

import type { UserNotifCategory } from "./user-channels-shared";

export interface UserChannelPolicy {
  category: UserNotifCategory;
  /**
   * Rótulo legível, usado na matriz de configuração por tipo.
   *
   * Está aqui — e não num mapa à parte — de propósito: assim é IMPOSSÍVEL
   * acrescentar um tipo sem rótulo. Um mapa separado permitiria o tipo entrar
   * na allowlist e aparecer como linha em branco na tela.
   */
  label: string;
}

export const USER_CHANNEL_REGISTRY: Record<string, UserChannelPolicy> = {
  // ── Andamento do negócio (motor deal-events.ts) ────────────────────────
  // `form_completed` preserva o type histórico; os demais são `deal_${event}`.
  form_completed: { category: "deal_updates", label: "Formulário concluído" },
  deal_stage_change: { category: "deal_updates", label: "Mudança de status do negócio" },
  deal_form_reminder: { category: "deal_updates", label: "Lembrete de preenchimento" },
  deal_contract_ready: { category: "deal_updates", label: "Contrato pronto" },
  deal_contract_sent: { category: "deal_updates", label: "Contrato enviado para assinatura" },
  participant_completed: { category: "deal_updates", label: "Participante concluiu a parte dele" },

  // ── Assinaturas (lib/clicksign/notify-envelope.ts) ─────────────────────
  envelope_signed: { category: "assinaturas", label: "Contrato assinado" },
  envelope_refused: { category: "assinaturas", label: "Assinatura recusada" },
  envelope_email_failed: { category: "assinaturas", label: "E-mail de assinatura não chegou" },

  // ── Certidões (lib/certidoes/executor.ts) ──────────────────────────────
  certidao_batch_complete: { category: "certidoes", label: "Lote de certidões concluído" },
  certidao_problem: { category: "certidoes", label: "Certidão travada" },
  certidao_data_missing: { category: "certidoes", label: "Certidão faltando dado" },

  // ── Financeiro (lib/financeiro/notifications.ts) ───────────────────────
  charge_created: { category: "financeiro", label: "Cobrança gerada" },
  charge_paid: { category: "financeiro", label: "Cobrança paga" },
  charge_overdue: { category: "financeiro", label: "Cobrança vencida" },
  charge_due_soon: { category: "financeiro", label: "Cobrança vencendo" },
  charge_cancelled: { category: "financeiro", label: "Cobrança cancelada" },
  charge_refunded: { category: "financeiro", label: "Cobrança estornada" },
  dual_approval_pending: { category: "financeiro", label: "Repasse aguardando aprovação" },
  dual_approval_resolved: { category: "financeiro", label: "Repasse aprovado ou recusado" },
  transfer_done: { category: "financeiro", label: "Repasse concluído" },
  transfer_failed: { category: "financeiro", label: "Repasse falhou" },

  // ── Propostas (lib/proposals/notify-proposal.ts) ───────────────────────
  proposal_completed: { category: "propostas", label: "Proposta aceita por todos" },
  proposal_accepted_party: { category: "propostas", label: "Proposta aceita por uma parte" },
  proposal_refused: { category: "propostas", label: "Proposta recusada" },
  proposal_expired: { category: "propostas", label: "Proposta expirada" },
  proposal_email_failed: { category: "propostas", label: "E-mail de proposta não chegou" },

  // ── Avisos do sistema ──────────────────────────────────────────────────
  contract_generation_failed: { category: "sistema", label: "Falha ao gerar contrato" },
  ai_budget_threshold: { category: "sistema", label: "Orçamento de IA no limite" },
  support_answered: { category: "sistema", label: "Suporte respondeu" },
  newton_request_fulfilled: { category: "sistema", label: "Newton conseguiu a informação" },
};

/** Tipos varridos pelo sweep — a query filtra por `type IN (...)`. */
export const USER_CHANNEL_TYPES = Object.keys(USER_CHANNEL_REGISTRY);

export function policyForType(type: string): UserChannelPolicy | null {
  return USER_CHANNEL_REGISTRY[type] ?? null;
}

// `buildUserNotifyMessage` saiu daqui: título e corpo agora viajam SEPARADOS
// até o agente, porque o Max precisa deles como variáveis distintas de template
// da Meta. Quem compõe a frase única (para o turn do Newton) é
// `lib/agents/whatsapp-router.ts`. Título e corpo continuam chegando prontos e
// truncados do sino (200/500 chars); a sanitização anti-injeção segue no
// transporte.
