/**
 * DTOs neutros de pagamento (multitenant Fase 0d). Provider-agnósticos — não
 * vazam tipos específicos do Asaas. Um provider futuro (Celcoin, etc.) mapeia
 * os próprios shapes pra estes. Ver docs/payments-architecture.md.
 */

export type PaymentBillingType = "BOLETO" | "CREDIT_CARD" | "PIX" | "UNDEFINED";

export interface PaymentSplit {
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
}

export interface CreateChargeInput {
  customerId: string;
  billingType: PaymentBillingType;
  value: number;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  externalReference?: string;
  splits?: PaymentSplit[];
}

export interface Charge {
  id: string;
  customerId: string;
  value: number;
  netValue?: number | null;
  status: string;
  billingType: PaymentBillingType;
  dueDate: string;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  externalReference?: string | null;
}

export interface CreateCustomerInput {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
}

export interface PaymentCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
  email?: string | null;
}

export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

export interface CreateTransferInput {
  value: number;
  description?: string;
  pixAddressKey?: string;
  pixAddressKeyType?: PixKeyType;
}

export interface Transfer {
  id: string;
  status: string;
  value: number;
}
