/**
 * CRUD de webhooks configurados na conta Asaas (/v3/webhooks).
 *
 * Permite cadastrar/listar/remover programaticamente os webhooks que
 * o Asaas envia para o Contractmaker, eliminando configuração manual
 * no dashboard.
 */

import { asaasFetch } from "./client";

export type AsaasWebhookEvent =
  | "PAYMENT_CREATED"
  | "PAYMENT_UPDATED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_OVERDUE"
  | "PAYMENT_DELETED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_RECEIVED_IN_CASH_UNDONE"
  | "PAYMENT_CHARGEBACK_REQUESTED"
  | "PAYMENT_CHARGEBACK_DISPUTE"
  | "PAYMENT_AWAITING_CHARGEBACK_REVERSAL"
  | "PAYMENT_DUNNING_REQUESTED"
  | "PAYMENT_DUNNING_RECEIVED"
  | "TRANSFER_CREATED"
  | "TRANSFER_DONE"
  | "TRANSFER_FAILED";

export const DEFAULT_CONTRACTMAKER_EVENTS: AsaasWebhookEvent[] = [
  "PAYMENT_CREATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_DELETED",
  "TRANSFER_DONE",
  "TRANSFER_FAILED",
];

export interface WebhookConfig {
  name: string;
  url: string;
  email: string;
  enabled: boolean;
  interrupted: boolean;
  apiVersion: 3;
  authToken: string;
  sendType: "SEQUENTIALLY" | "NON_SEQUENTIALLY";
  events: AsaasWebhookEvent[];
}

export interface WebhookRow extends WebhookConfig {
  id: string;
}

export interface WebhookList {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: WebhookRow[];
}

/**
 * Lista webhooks cadastrados na conta. Usa master API key por default.
 */
export async function listWebhooks(apiKey?: string): Promise<WebhookList> {
  return asaasFetch<WebhookList>("/webhooks", {
    method: "GET",
    apiKey,
    retry: false,
  });
}

/**
 * Cria um webhook novo. Não-idempotente — se chamar 2x cria 2 webhooks
 * apontando para a mesma URL. Use `upsertWebhookByUrl` em workflows
 * repetíveis (QA setup, etc.).
 */
export async function createWebhook(
  config: WebhookConfig,
  apiKey?: string
): Promise<WebhookRow> {
  return asaasFetch<WebhookRow>("/webhooks", {
    method: "POST",
    body: config,
    apiKey,
    retry: false,
  });
}

/**
 * Remove webhook por id.
 */
export async function deleteWebhook(
  id: string,
  apiKey?: string
): Promise<void> {
  await asaasFetch(`/webhooks/${id}`, {
    method: "DELETE",
    apiKey,
    retry: false,
  });
}

/**
 * Cadastra webhook garantindo unicidade por URL. Se já existe webhook
 * com a mesma `url`, atualiza via DELETE + POST (Asaas v3 não tem PATCH
 * de webhook). Retorna o webhook final (novo ou recriado).
 */
export async function upsertWebhookByUrl(
  config: WebhookConfig,
  apiKey?: string
): Promise<{ webhook: WebhookRow; created: boolean; replaced: boolean }> {
  const existing = await listWebhooks(apiKey);
  const match = existing.data.find((w) => w.url === config.url);

  if (match) {
    await deleteWebhook(match.id, apiKey);
    const created = await createWebhook(config, apiKey);
    return { webhook: created, created: false, replaced: true };
  }

  const created = await createWebhook(config, apiKey);
  return { webhook: created, created: true, replaced: false };
}
