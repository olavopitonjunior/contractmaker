/**
 * Endpoints sandbox-only do Asaas (/v3/sandbox/*).
 *
 * Aceleram setup de QA e testes de integração sem esperar pagamentos reais
 * ou aprovação manual de subconta no painel. **Nunca chamar em produção.**
 */

import { asaasFetch } from "./client";

/**
 * Status de aprovação de cada área da subconta.
 * Após `approveSandboxAccount`, todos devem virar APPROVED.
 */
export interface AccountApprovalStatus {
  id: string;
  commercialInfo: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
  bankAccountInfo: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
  documentation: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
  general: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
}

/**
 * Aprova a subconta sandbox sem esperar revisão humana.
 *
 * IMPORTANTE: precisa ser chamado com a `apiKey` **da subconta** (não da master).
 * Após aprovação, status em `/v3/myAccount/status` reflete tudo APPROVED.
 *
 * @throws AsaasError se ASAAS_ENV=production ou se apiKey inválida
 */
export async function approveSandboxAccount(
  subaccountApiKey: string
): Promise<AccountApprovalStatus> {
  if (process.env.ASAAS_ENV === "production") {
    throw new Error(
      "approveSandboxAccount: não pode rodar com ASAAS_ENV=production"
    );
  }
  return asaasFetch<AccountApprovalStatus>("/sandbox/myAccount/approve", {
    method: "POST",
    body: {},
    apiKey: subaccountApiKey,
    retry: false,
  });
}

/**
 * Confirma pagamento de uma cobrança sandbox (simula PIX/boleto pago).
 * Dispara webhooks PAYMENT_CONFIRMED → PAYMENT_RECEIVED.
 */
export async function confirmSandboxPayment(
  paymentId: string,
  apiKey?: string
): Promise<unknown> {
  if (process.env.ASAAS_ENV === "production") {
    throw new Error(
      "confirmSandboxPayment: não pode rodar com ASAAS_ENV=production"
    );
  }
  return asaasFetch(`/sandbox/payment/${paymentId}/confirm`, {
    method: "POST",
    body: {},
    apiKey,
    retry: false,
  });
}

/**
 * Força status OVERDUE em uma cobrança sandbox.
 * Dispara webhook PAYMENT_OVERDUE. Útil para testar cobrança atrasada.
 */
export async function overdueSandboxPayment(
  paymentId: string,
  apiKey?: string
): Promise<unknown> {
  if (process.env.ASAAS_ENV === "production") {
    throw new Error(
      "overdueSandboxPayment: não pode rodar com ASAAS_ENV=production"
    );
  }
  return asaasFetch(`/sandbox/payment/${paymentId}/overdue`, {
    method: "POST",
    body: {},
    apiKey,
    retry: false,
  });
}
