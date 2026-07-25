/**
 * Allowlist EXPLÍCITA de quais tipos de Notification podem sair em canal
 * externo (WhatsApp) pro usuário da plataforma, e em que categoria cada um
 * cai pra resolução de preferência.
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
}

export const USER_CHANNEL_REGISTRY: Record<string, UserChannelPolicy> = {
  // ── Andamento do negócio (motor deal-events.ts) ────────────────────────
  // `form_completed` preserva o type histórico; os demais são `deal_${event}`.
  form_completed: { category: "deal_updates" },
  deal_stage_change: { category: "deal_updates" },
  deal_form_reminder: { category: "deal_updates" },
  deal_contract_ready: { category: "deal_updates" },
  deal_contract_sent: { category: "deal_updates" },
  participant_completed: { category: "deal_updates" },

  // ── Assinaturas (lib/clicksign/notify-envelope.ts) ─────────────────────
  envelope_signed: { category: "assinaturas" },
  envelope_refused: { category: "assinaturas" },
  envelope_email_failed: { category: "assinaturas" },

  // ── Certidões (lib/certidoes/executor.ts) ──────────────────────────────
  certidao_batch_complete: { category: "certidoes" },
  certidao_problem: { category: "certidoes" },
  certidao_data_missing: { category: "certidoes" },

  // ── Financeiro (lib/financeiro/notifications.ts) ───────────────────────
  charge_created: { category: "financeiro" },
  charge_paid: { category: "financeiro" },
  charge_overdue: { category: "financeiro" },
  charge_due_soon: { category: "financeiro" },
  charge_cancelled: { category: "financeiro" },
  charge_refunded: { category: "financeiro" },
  dual_approval_pending: { category: "financeiro" },
  dual_approval_resolved: { category: "financeiro" },
  transfer_done: { category: "financeiro" },
  transfer_failed: { category: "financeiro" },

  // ── Propostas (lib/proposals/notify-proposal.ts) ───────────────────────
  proposal_completed: { category: "propostas" },
  proposal_accepted_party: { category: "propostas" },
  proposal_refused: { category: "propostas" },
  proposal_expired: { category: "propostas" },
  proposal_email_failed: { category: "propostas" },

  // ── Avisos do sistema ──────────────────────────────────────────────────
  contract_generation_failed: { category: "sistema" },
  ai_budget_threshold: { category: "sistema" },
  support_answered: { category: "sistema" },
  newton_request_fulfilled: { category: "sistema" },
};

/** Tipos varridos pelo sweep — a query filtra por `type IN (...)`. */
export const USER_CHANNEL_TYPES = Object.keys(USER_CHANNEL_REGISTRY);

export function policyForType(type: string): UserChannelPolicy | null {
  return USER_CHANNEL_REGISTRY[type] ?? null;
}

/**
 * Texto da mensagem. Título e corpo já vêm prontos e truncados do sino
 * (200/500 chars); a sanitização anti-injeção acontece no trigger, que é o
 * chokepoint — não duplicar aqui.
 */
export function buildUserNotifyMessage(n: {
  title: string;
  body: string;
}): string {
  return `${n.title}: ${n.body}`;
}
