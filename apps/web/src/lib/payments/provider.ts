import type {
  Charge,
  CreateChargeInput,
  CreateCustomerInput,
  CreateTransferInput,
  PaymentCustomer,
  Transfer,
} from "./types";

/**
 * PaymentProvider — o seam de abstração de provedor de pagamento (Fase 0d).
 * Cobre o núcleo de movimentação de dinheiro que um provider precisa
 * reimplementar (cobranças, clientes, transferências). Onboarding/KYC de
 * subconta fica fora do v1 por ser muito específico de cada provider.
 *
 * Decisão (Apêndice B do plano): NÃO migrar de Asaas agora — só introduzir a
 * interface pra preservar opcionalidade. Reavaliar aos ~2k tenants ou R$5M/mês.
 * Ver [[project-celcoin-migration-analysis]] e docs/payments-architecture.md.
 */
export interface PaymentProvider {
  /** Identificador do provider concreto (ex.: "asaas"). */
  readonly name: string;

  // Cobranças
  createCharge(input: CreateChargeInput): Promise<Charge>;
  getCharge(chargeId: string): Promise<Charge>;
  cancelCharge(chargeId: string): Promise<{ deleted: boolean; id: string }>;
  /** Estorno total (value omitido) ou parcial. */
  refundCharge(chargeId: string, value?: number): Promise<Charge>;

  // Clientes
  upsertCustomer(input: CreateCustomerInput): Promise<PaymentCustomer>;
  getCustomer(customerId: string): Promise<PaymentCustomer>;

  // Transferências (saída de dinheiro)
  createTransfer(input: CreateTransferInput): Promise<Transfer>;
  cancelTransfer(transferId: string): Promise<{ deleted: boolean; id: string }>;
}

export class PaymentProviderError extends Error {
  provider: string;
  cause?: unknown;
  constructor(provider: string, message: string, cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = "PaymentProviderError";
    this.provider = provider;
    this.cause = cause;
  }
}
