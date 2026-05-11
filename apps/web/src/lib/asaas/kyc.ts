/**
 * KYC — criação de subconta white-label + upload de documentos.
 *
 * Endpoints:
 *  POST /accounts              → cria subconta (master key)
 *  GET  /myAccount/status      → status geral/docs/bank (com apiKey da subconta)
 *  GET  /myAccount/documents   → lista slots de documentos pendentes
 *  POST /myAccount/documents/{id}  → upload multipart (documentFile field)
 */

import { asaasFetch } from "./client";
import type {
  AsaasSubaccountResponse,
  CreateSubaccountInput,
  AsaasMyAccountStatus,
  AsaasDocumentSlot,
  AsaasSubaccountListItem,
  AsaasAccountListResponse,
  AsaasAccessTokenResponse,
} from "./types";

/**
 * Cria subconta usando a master API key do Contractmaker.
 * Retorna apiKey + walletId + status inicial.
 */
export async function createSubaccount(
  input: CreateSubaccountInput
): Promise<AsaasSubaccountResponse> {
  // Asaas espera cpfCnpj sem formatação
  const sanitized = {
    ...input,
    cpfCnpj: input.cpfCnpj.replace(/\D/g, ""),
    mobilePhone: input.mobilePhone.replace(/\D/g, ""),
    postalCode: input.postalCode.replace(/\D/g, ""),
  };
  return await asaasFetch<AsaasSubaccountResponse>("/accounts", {
    method: "POST",
    body: sanitized,
    // Sem `apiKey` → usa master
  });
}

export async function getMyAccountStatus(params: {
  apiKey: string;
}): Promise<AsaasMyAccountStatus> {
  return await asaasFetch<AsaasMyAccountStatus>("/myAccount/status", {
    apiKey: params.apiKey,
  });
}

export async function listMyAccountDocuments(params: {
  apiKey: string;
}): Promise<{ data: AsaasDocumentSlot[] }> {
  return await asaasFetch<{ data: AsaasDocumentSlot[] }>(
    "/myAccount/documents",
    { apiKey: params.apiKey }
  );
}

/**
 * Lista subcontas criadas pela conta-mãe Asaas. Usa master key (ASAAS_API_KEY).
 * Filtros por cpfCnpj/email/name/walletId. Não retorna apiKey (recuperar via
 * createSubaccountAccessToken se necessário).
 *
 * Use case principal: recuperar conta órfã — subconta criada com sucesso no
 * Asaas mas cujo POST /accounts falhou no commit local antes de persistir
 * apiKey/walletId.
 */
export async function listSubaccounts(params: {
  cpfCnpj?: string;
  email?: string;
  name?: string;
  walletId?: string;
  limit?: number;
  offset?: number;
}): Promise<AsaasAccountListResponse> {
  return await asaasFetch<AsaasAccountListResponse>("/accounts", {
    query: {
      cpfCnpj: params.cpfCnpj?.replace(/\D/g, "") || undefined,
      email: params.email,
      name: params.name,
      walletId: params.walletId,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
    },
  });
}

export async function retrieveSubaccount(params: {
  asaasAccountId: string;
}): Promise<AsaasSubaccountListItem> {
  return await asaasFetch<AsaasSubaccountListItem>(
    `/accounts/${params.asaasAccountId}`
  );
}

/**
 * Cria uma nova apiKey pra subconta usando a master key. Útil pra recovery
 * de conta órfã (apiKey original perdida no commit local falho).
 *
 * IMPORTANTE: a apiKey só é retornada nesta criação — não há endpoint pra
 * buscar a string da apiKey depois. GET /accessTokens só lista metadados.
 *
 * GOTCHA: este endpoint exige WHITELIST DE IPs configurada na conta-mãe.
 * Vercel serverless tem IPs dinâmicos do AWS Lambda — uso prático limitado.
 * Caso receba `invalid_action` com mensagem de whitelist, cair pra
 * `resendActivationLink` (envia email pra subconta com link de ativação,
 * onde o owner vê a apiKey).
 */
export async function createSubaccountAccessToken(params: {
  asaasAccountId: string;
  name: string;
  /** ISO date string. Sem, expira por desuso. */
  expirationDate?: string;
}): Promise<AsaasAccessTokenResponse> {
  return await asaasFetch<AsaasAccessTokenResponse>(
    `/accounts/${params.asaasAccountId}/accessTokens`,
    {
      method: "POST",
      body: {
        name: params.name,
        expirationDate: params.expirationDate,
      },
    }
  );
}

/**
 * Reenvia o link de ativação/reset de senha pro email registrado da subconta
 * non-BaaS. Use case: a apiKey foi perdida e a whitelist bloqueia
 * /accessTokens — o owner abre o link no email e vê a apiKey no portal Asaas.
 *
 * Limitação Asaas: só permite UM reenvio por subconta.
 */
export async function resendActivationLink(params: {
  asaasAccountId: string;
}): Promise<void> {
  await asaasFetch<void>(
    `/accounts/${params.asaasAccountId}/resendActivationLink`,
    { method: "POST", body: {} }
  );
}

/**
 * Upload de um documento KYC — multipart form-data com field `documentFile`.
 */
export async function uploadMyAccountDocument(params: {
  documentId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
  apiKey: string;
}): Promise<{ id: string; status: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.file)], {
    type: params.mimeType,
  });
  form.append("documentFile", blob, params.filename);

  return await asaasFetch(`/myAccount/documents/${params.documentId}`, {
    method: "POST",
    body: form,
    isMultipart: true,
    apiKey: params.apiKey,
  });
}
