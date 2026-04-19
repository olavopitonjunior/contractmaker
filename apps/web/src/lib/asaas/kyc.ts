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
