/**
 * DTOs da API Asaas v3. Apenas os campos que usamos — outros podem estar
 * presentes na response mas são ignorados.
 *
 * Docs: https://docs.asaas.com/reference/
 */

export type AsaasEnv = "sandbox" | "production";

export const ASAAS_BASE_URLS = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
} as const;

// ---------- Customer ----------

export interface AsaasCustomer {
  id: string;
  object: "customer";
  name: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  cpfCnpj: string;
  personType?: "FISICA" | "JURIDICA";
  address?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  postalCode?: string | null;
  externalReference?: string | null;
  notificationDisabled?: boolean;
  additionalEmails?: string | null;
  municipalInscription?: string | null;
  stateInscription?: string | null;
  observations?: string | null;
  deleted?: boolean;
  dateCreated: string;
}

export interface CreateCustomerInput {
  name: string;
  cpfCnpj: string;
  email?: string;
  mobilePhone?: string;
  phone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  company?: string;
}

// ---------- Payment ----------

export type AsaasBillingType =
  | "BOLETO"
  | "PIX"
  | "CREDIT_CARD"
  | "UNDEFINED";

export type AsaasPaymentStatus =
  | "PENDING"
  | "RECEIVED"
  | "CONFIRMED"
  | "OVERDUE"
  | "REFUNDED"
  | "RECEIVED_IN_CASH"
  | "REFUND_REQUESTED"
  | "REFUND_IN_PROGRESS"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
  | "AWAITING_CHARGEBACK_REVERSAL"
  | "DUNNING_REQUESTED"
  | "DUNNING_RECEIVED"
  | "AWAITING_RISK_ANALYSIS";

export interface AsaasSplit {
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
  totalFixedValue?: number;
}

export interface AsaasDiscount {
  value: number;
  dueDateLimitDays?: number;
  type: "FIXED" | "PERCENTAGE";
}

export interface AsaasFine {
  value: number;
  type?: "FIXED" | "PERCENTAGE";
}

export interface AsaasInterest {
  value: number;
  type?: "PERCENTAGE";
}

export interface CreatePaymentInput {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  externalReference?: string;
  installmentCount?: number;
  installmentValue?: number;
  discount?: AsaasDiscount;
  fine?: AsaasFine;
  interest?: AsaasInterest;
  postalService?: boolean;
  split?: AsaasSplit[];
}

export interface AsaasPayment {
  id: string;
  object: "payment";
  customer: string;
  paymentLink?: string | null;
  dueDate: string;
  value: number;
  netValue?: number;
  billingType: AsaasBillingType;
  status: AsaasPaymentStatus;
  description?: string | null;
  externalReference?: string | null;
  originalValue?: number | null;
  interestValue?: number | null;
  invoiceUrl?: string | null;
  invoiceNumber?: string | null;
  bankSlipUrl?: string | null;
  transactionReceiptUrl?: string | null;
  nossoNumero?: string | null;
  installment?: string | null;
  confirmedDate?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  dateCreated: string;
  originalDueDate?: string;
  deleted?: boolean;
  split?: AsaasSplit[];
}

export interface AsaasPixQrCode {
  success: boolean;
  encodedImage: string; // base64 PNG
  payload: string; // copia-e-cola
  expirationDate?: string;
}

export interface AsaasBankSlipData {
  identificationField: string;
  nossoNumero: string;
  barCode: string;
  bankSlipUrl: string;
}

// ---------- Subaccount (KYC) ----------

export interface CreateSubaccountInput {
  name: string;
  email: string;
  loginEmail?: string;
  cpfCnpj: string;
  birthDate?: string; // YYYY-MM-DD (PF)
  companyType?: "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";
  phone?: string;
  mobilePhone: string;
  site?: string;
  incomeValue: number; // renda ou faturamento mensal
  address: string;
  addressNumber: string;
  complement?: string;
  province: string;
  postalCode: string;
  webhooks?: Array<{
    name: string;
    url: string;
    email?: string;
    authToken?: string;
    enabled?: boolean;
    interrupted?: boolean;
    apiVersion?: number;
    events?: string[];
  }>;
}

export interface AsaasSubaccountResponse {
  object?: string;
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
  walletId: string;
  accountNumber?: {
    agency: string;
    account: string;
    accountDigit: string;
  };
  apiKey: string;
  status?: {
    id: string;
    commercialInfo: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
    documentation: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
    bankAccountInfo: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
    general: "PENDING" | "APPROVED" | "REJECTED" | "AWAITING_APPROVAL" | "AWAITING_ACTION_AUTHORIZATION";
  };
}

export interface AsaasMyAccountStatus {
  id?: string;
  commercialInfo: string;
  documentation: string;
  bankAccountInfo: string;
  general: string;
  createdOn?: string;
  rejectReasonDescriptions?: string;
}

export interface AsaasDocumentSlot {
  id: string;
  type: string;
  title?: string;
  description?: string;
  onboardingStep?: string;
  status: "NOT_SENT" | "PENDING" | "APPROVED" | "REJECTED" | "RECEIVED";
  responsibleType?: "PJ" | "PF";
  rejectReasonDescriptions?: string | null;
}

// ---------- Webhook event ----------

export type AsaasWebhookEventName =
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
  | "TRANSFER_FAILED"
  | "ACCOUNT_STATUS_UPDATED";

export interface AsaasWebhookPayload {
  id: string; // evt_xxx
  event: AsaasWebhookEventName;
  dateCreated: string;
  payment?: AsaasPayment;
  transfer?: unknown;
  account?: { id: string };
}

// ---------- Helpers ----------

export function mapAsaasStatusToInternal(
  status: AsaasPaymentStatus
): string {
  switch (status) {
    case "PENDING":
      return "PENDING";
    case "CONFIRMED":
      return "CONFIRMED";
    case "RECEIVED":
      return "RECEIVED";
    case "OVERDUE":
      return "OVERDUE";
    case "REFUNDED":
      return "REFUNDED";
    case "RECEIVED_IN_CASH":
      return "RECEIVED_IN_CASH";
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
      return "REFUND_PENDING";
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "CHARGEBACK";
    case "DUNNING_REQUESTED":
    case "DUNNING_RECEIVED":
      return "DUNNING";
    case "AWAITING_RISK_ANALYSIS":
      return "RISK_ANALYSIS";
    default:
      return status;
  }
}
