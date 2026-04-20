import { asaasFetch } from "./client";
import type { AsaasCustomer, CreateCustomerInput } from "./types";

export async function findCustomerByCpfCnpj(params: {
  cpfCnpj: string;
  apiKey: string;
}): Promise<AsaasCustomer | null> {
  const digits = params.cpfCnpj.replace(/\D/g, "");
  const res = await asaasFetch<{ data: AsaasCustomer[] }>("/customers", {
    query: { cpfCnpj: digits, limit: 1 },
    apiKey: params.apiKey,
  });
  return res?.data?.[0] ?? null;
}

export async function createCustomer(params: {
  input: CreateCustomerInput;
  apiKey: string;
}): Promise<AsaasCustomer> {
  return await asaasFetch<AsaasCustomer>("/customers", {
    method: "POST",
    body: {
      ...params.input,
      cpfCnpj: params.input.cpfCnpj.replace(/\D/g, ""),
    },
    apiKey: params.apiKey,
  });
}

/**
 * Busca ou cria — evita erro 409 "cpfCnpj_already_exists" em concorrência.
 */
export async function upsertCustomer(params: {
  input: CreateCustomerInput;
  apiKey: string;
}): Promise<AsaasCustomer> {
  const existing = await findCustomerByCpfCnpj({
    cpfCnpj: params.input.cpfCnpj,
    apiKey: params.apiKey,
  });
  if (existing) return existing;
  return createCustomer(params);
}

export async function updateCustomer(params: {
  asaasId: string;
  input: Partial<CreateCustomerInput>;
  apiKey: string;
}): Promise<AsaasCustomer> {
  return await asaasFetch<AsaasCustomer>(`/customers/${params.asaasId}`, {
    method: "POST", // Asaas usa POST para update em alguns endpoints
    body: params.input,
    apiKey: params.apiKey,
  });
}

export async function getCustomer(params: {
  asaasId: string;
  apiKey: string;
}): Promise<AsaasCustomer> {
  return await asaasFetch<AsaasCustomer>(`/customers/${params.asaasId}`, {
    apiKey: params.apiKey,
  });
}

export async function deleteCustomer(params: {
  asaasId: string;
  apiKey: string;
}): Promise<{ deleted: boolean }> {
  return await asaasFetch(`/customers/${params.asaasId}`, {
    method: "DELETE",
    apiKey: params.apiKey,
  });
}
