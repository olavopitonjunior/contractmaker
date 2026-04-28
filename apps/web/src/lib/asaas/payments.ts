import { asaasFetch } from "./client";
import type {
  AsaasPayment,
  AsaasPixQrCode,
  AsaasBankSlipData,
  CreatePaymentInput,
} from "./types";

export async function createPayment(params: {
  input: CreatePaymentInput;
  apiKey: string;
}): Promise<AsaasPayment> {
  return await asaasFetch<AsaasPayment>("/payments", {
    method: "POST",
    body: params.input,
    apiKey: params.apiKey,
  });
}

export async function getPayment(params: {
  asaasId: string;
  apiKey: string;
}): Promise<AsaasPayment> {
  return await asaasFetch<AsaasPayment>(`/payments/${params.asaasId}`, {
    apiKey: params.apiKey,
  });
}

export interface ListPaymentsQuery {
  customer?: string;
  billingType?: string;
  status?: string;
  "dateCreated[ge]"?: string;
  "dateCreated[le]"?: string;
  "dueDate[ge]"?: string;
  "dueDate[le]"?: string;
  "paymentDate[ge]"?: string;
  "paymentDate[le]"?: string;
  externalReference?: string;
  offset?: number;
  limit?: number;
}

export interface AsaasPaymentList {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasPayment[];
}

export async function listPayments(params: {
  query?: ListPaymentsQuery;
  apiKey: string;
}): Promise<AsaasPaymentList> {
  return await asaasFetch<AsaasPaymentList>("/payments", {
    query: params.query as Record<string, any>,
    apiKey: params.apiKey,
  });
}

export async function cancelPayment(params: {
  asaasId: string;
  apiKey: string;
}): Promise<{ deleted: boolean; id: string }> {
  return await asaasFetch(`/payments/${params.asaasId}`, {
    method: "DELETE",
    apiKey: params.apiKey,
  });
}

export async function refundPayment(params: {
  asaasId: string;
  value?: number; // parcial; se omitir, estorna tudo
  description?: string;
  apiKey: string;
}): Promise<AsaasPayment> {
  return await asaasFetch<AsaasPayment>(
    `/payments/${params.asaasId}/refund`,
    {
      method: "POST",
      body: { value: params.value, description: params.description },
      apiKey: params.apiKey,
    }
  );
}

export async function getPixQrCode(params: {
  asaasId: string;
  apiKey: string;
}): Promise<AsaasPixQrCode> {
  return await asaasFetch<AsaasPixQrCode>(
    `/payments/${params.asaasId}/pixQrCode`,
    { apiKey: params.apiKey }
  );
}

export async function getBankSlipData(params: {
  asaasId: string;
  apiKey: string;
}): Promise<AsaasBankSlipData> {
  return await asaasFetch<AsaasBankSlipData>(
    `/payments/${params.asaasId}/identificationField`,
    { apiKey: params.apiKey }
  );
}

export async function markAsReceivedInCash(params: {
  asaasId: string;
  paymentDate: string; // YYYY-MM-DD
  value: number;
  notifyCustomer?: boolean;
  apiKey: string;
}): Promise<AsaasPayment> {
  return await asaasFetch<AsaasPayment>(
    `/payments/${params.asaasId}/receiveInCash`,
    {
      method: "POST",
      body: {
        paymentDate: params.paymentDate,
        value: params.value,
        notifyCustomer: params.notifyCustomer ?? false,
      },
      apiKey: params.apiKey,
    }
  );
}

/**
 * Atualiza campos editáveis de uma cobrança Asaas (PENDING/OVERDUE).
 * Asaas aceita POST no endpoint do payment com qualquer subset.
 * Caller deve garantir que pelo menos um campo foi passado.
 */
export async function updatePayment(params: {
  asaasId: string;
  fields: { value?: number; dueDate?: string; description?: string };
  apiKey: string;
}): Promise<AsaasPayment> {
  return await asaasFetch<AsaasPayment>(`/payments/${params.asaasId}`, {
    method: "POST",
    body: params.fields,
    apiKey: params.apiKey,
  });
}

/** @deprecated use updatePayment com { dueDate } */
export async function updateDueDate(params: {
  asaasId: string;
  newDueDate: string; // YYYY-MM-DD
  apiKey: string;
}): Promise<AsaasPayment> {
  return updatePayment({
    asaasId: params.asaasId,
    fields: { dueDate: params.newDueDate },
    apiKey: params.apiKey,
  });
}

export async function resendNotification(params: {
  asaasId: string;
  apiKey: string;
}): Promise<{ notifications: unknown }> {
  // Endpoint Asaas: POST /payments/{id}/notifications
  // Nem sempre disponível em sandbox — fallback em caller.
  return await asaasFetch(`/payments/${params.asaasId}/notifications`, {
    method: "POST",
    apiKey: params.apiKey,
  });
}
