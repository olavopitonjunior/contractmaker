/**
 * Endpoints financeiros Asaas — saldo + extrato (financial transactions).
 *
 * Note: Asaas v3 oficialmente:
 *  - GET /finance/balance       — saldo (pode retornar balance number OR object)
 *  - GET /financialTransactions — extrato paginado
 *
 * Ambos usam apiKey da subconta (escopo: a conta titular da key).
 */

import { asaasFetch } from "./client";

export interface AsaasBalanceResponse {
  balance?: number;
  totalBalance?: number;
  blockedBalance?: number;
  pendingBalance?: number;
  availableBalance?: number;
}

export async function getBalance(params: {
  apiKey: string;
}): Promise<AsaasBalanceResponse> {
  // Tentativa primária: /finance/balance
  try {
    const res = await asaasFetch<any>("/finance/balance", {
      apiKey: params.apiKey,
    });
    // A resposta pode vir como {balance: number} ou {totalBalance, blockedBalance, etc}
    if (typeof res === "number") return { balance: res };
    return res as AsaasBalanceResponse;
  } catch {
    // Fallback legado: algumas versões expõem como /accounts/balance
    const res = await asaasFetch<AsaasBalanceResponse>("/accounts/balance", {
      apiKey: params.apiKey,
    });
    return res;
  }
}

export type AsaasFinancialTransactionType =
  | "PAYMENT_RECEIVED"
  | "PAYMENT_FEE"
  | "PAYMENT_OVERPAID"
  | "REFUND"
  | "REFUND_FEE"
  | "TRANSFER"
  | "TRANSFER_FEE"
  | "CHARGEBACK"
  | "ANTICIPATION"
  | "RESERVE_FOR_DEBT"
  | "OTHER";

export interface AsaasFinancialTransaction {
  object: "financialTransaction";
  id?: string;
  type: AsaasFinancialTransactionType | string;
  value: number;
  netValue?: number;
  date: string; // YYYY-MM-DD
  description?: string | null;
  externalReference?: string | null;
  paymentId?: string | null;
  transferId?: string | null;
  balance?: number;
}

export interface AsaasFinancialTransactionList {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasFinancialTransaction[];
}

export interface ListStatementQuery {
  startDate?: string; // YYYY-MM-DD
  finishDate?: string;
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export async function listFinancialTransactions(params: {
  query?: ListStatementQuery;
  apiKey: string;
}): Promise<AsaasFinancialTransactionList> {
  return await asaasFetch<AsaasFinancialTransactionList>(
    "/financialTransactions",
    {
      query: params.query as Record<string, any>,
      apiKey: params.apiKey,
    }
  );
}
