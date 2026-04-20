/**
 * Transferências (saques) da subconta Asaas para:
 *  - chave PIX (rápido, sem custo)
 *  - conta bancária (TED, D+1)
 *
 * Endpoints Asaas:
 *  POST   /v3/transfers
 *  GET    /v3/transfers
 *  DELETE /v3/transfers/{id}  (cancela PENDING)
 */

import { asaasFetch } from "./client";

export type AsaasTransferType = "PIX" | "TED";

export type AsaasTransferStatus =
  | "PENDING"
  | "DONE"
  | "FAILED"
  | "CANCELLED"
  | "BANK_PROCESSING";

export interface BankAccountInput {
  bank: { code: string };
  accountName?: string;
  ownerName: string;
  cpfCnpj: string;
  agency: string;
  account: string;
  accountDigit: string;
  bankAccountType?: "CONTA_CORRENTE" | "CONTA_POUPANCA";
}

export interface CreateTransferInput {
  value: number;
  description?: string;
  pixAddressKey?: string;
  pixAddressKeyType?: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";
  bankAccount?: BankAccountInput;
}

export interface AsaasTransfer {
  object: "transfer";
  id: string;
  dateCreated: string;
  status: AsaasTransferStatus;
  effectiveDate?: string | null;
  scheduledDate?: string | null;
  type: AsaasTransferType;
  value: number;
  netValue?: number;
  transferFee?: number;
  operationType?: string;
  description?: string | null;
  bankAccount?: any;
  pixAddressKey?: string | null;
  failReason?: string | null;
}

export async function createTransfer(params: {
  input: CreateTransferInput;
  apiKey: string;
}): Promise<AsaasTransfer> {
  return await asaasFetch<AsaasTransfer>("/transfers", {
    method: "POST",
    body: params.input,
    apiKey: params.apiKey,
    retry: false, // nunca retry em operação que movimenta dinheiro
  });
}

export interface ListTransfersQuery {
  "dateCreated[ge]"?: string;
  "dateCreated[le]"?: string;
  status?: AsaasTransferStatus;
  offset?: number;
  limit?: number;
}

export interface AsaasTransferList {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasTransfer[];
}

export async function listTransfers(params: {
  query?: ListTransfersQuery;
  apiKey: string;
}): Promise<AsaasTransferList> {
  return await asaasFetch<AsaasTransferList>("/transfers", {
    query: params.query as Record<string, any>,
    apiKey: params.apiKey,
  });
}

export async function cancelTransfer(params: {
  asaasId: string;
  apiKey: string;
}): Promise<{ deleted: boolean; id: string }> {
  return await asaasFetch(`/transfers/${params.asaasId}`, {
    method: "DELETE",
    apiKey: params.apiKey,
    retry: false,
  });
}
