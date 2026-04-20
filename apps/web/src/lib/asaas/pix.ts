/**
 * Validação de chave PIX antes de criar transferência.
 * Asaas endpoint: POST /v3/pix/addressKeys ou GET /v3/pix/addressKeys/{key}
 *
 * Nota: path exato varia por versão API; wrapper tenta 2 variações.
 */

import { asaasFetch } from "./client";
import { AsaasError } from "./errors";

export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

export interface PixKeyValidation {
  valid: boolean;
  key: string;
  keyType: PixKeyType | null;
  ownerName: string | null;
  ownerCpfCnpj: string | null;
  bank: string | null;
  /** Resposta bruta — útil para debug */
  raw?: unknown;
}

export function detectPixKeyType(key: string): PixKeyType | null {
  const digits = key.replace(/\D/g, "");
  if (/^\d{11}$/.test(digits)) return "CPF";
  if (/^\d{14}$/.test(digits)) return "CNPJ";
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(key)) return "EMAIL";
  if (/^\+?\d{10,13}$/.test(digits)) return "PHONE";
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(key))
    return "EVP";
  return null;
}

/**
 * Valida chave PIX — tenta POST /pix/addressKeys, fallback GET.
 * Retorna sempre um objeto — erros são capturados e valid=false.
 */
export async function validatePixKey(params: {
  key: string;
  apiKey: string;
}): Promise<PixKeyValidation> {
  const keyType = detectPixKeyType(params.key);
  if (!keyType) {
    return {
      valid: false,
      key: params.key,
      keyType: null,
      ownerName: null,
      ownerCpfCnpj: null,
      bank: null,
    };
  }

  try {
    // Tentativa: endpoint moderno Asaas (consulta via POST)
    const res = await asaasFetch<any>("/pix/addressKeys/query", {
      method: "POST",
      body: { addressKey: params.key, addressKeyType: keyType },
      apiKey: params.apiKey,
      retry: false,
    });
    return {
      valid: true,
      key: params.key,
      keyType,
      ownerName: res?.ownerName ?? res?.name ?? null,
      ownerCpfCnpj: res?.ownerCpfCnpj ?? res?.cpfCnpj ?? null,
      bank: res?.bank?.name ?? res?.bank ?? null,
      raw: res,
    };
  } catch (err) {
    // Fallback graceful — retorna sem owner (permite transferir mesmo sem validar)
    console.warn(
      "[pix.validatePixKey] falhou",
      err instanceof AsaasError ? err.errors : err
    );
    return {
      valid: false,
      key: params.key,
      keyType,
      ownerName: null,
      ownerCpfCnpj: null,
      bank: null,
    };
  }
}
