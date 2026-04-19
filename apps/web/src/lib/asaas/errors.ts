/**
 * Erros da API Asaas — mapeamento para mensagens PT-BR.
 *
 * Response de erro típica:
 *   { errors: [{ code: "invalid_cpfCnpj", description: "..." }] }
 */

export interface AsaasErrorDetail {
  code: string;
  description: string;
}

export class AsaasError extends Error {
  status: number;
  errors: AsaasErrorDetail[];
  endpoint: string;

  constructor(params: {
    status: number;
    errors: AsaasErrorDetail[];
    endpoint: string;
    message?: string;
  }) {
    super(params.message ?? params.errors[0]?.description ?? `Asaas error ${params.status}`);
    this.name = "AsaasError";
    this.status = params.status;
    this.errors = params.errors;
    this.endpoint = params.endpoint;
  }

  toJSON() {
    return {
      status: this.status,
      endpoint: this.endpoint,
      errors: this.errors,
      message: this.message,
    };
  }
}

const CODE_TRANSLATIONS: Record<string, string> = {
  invalid_cpfCnpj: "CPF/CNPJ inválido",
  invalid_email: "Email inválido",
  invalid_mobilePhone: "Celular inválido",
  invalid_postalCode: "CEP inválido",
  invalid_value: "Valor inválido",
  invalid_dueDate: "Data de vencimento inválida",
  invalid_billingType: "Método de cobrança inválido",
  invalid_customer: "Cliente Asaas inválido",
  invalid_walletId: "walletId inválido ou não encontrado",
  invalid_split: "Configuração de split inválida",
  invalid_description: "Descrição inválida",
  insufficient_balance: "Saldo insuficiente para transferência",
  unauthorized: "API key inválida ou sem permissão",
  account_not_approved: "Subconta ainda não aprovada",
  cpfCnpj_already_exists: "Cliente com este CPF/CNPJ já existe",
  rate_limit_exceeded: "Muitas requisições — aguarde alguns segundos",
};

export function translateAsaasError(code: string, description: string): string {
  return CODE_TRANSLATIONS[code] ?? description ?? code;
}

/**
 * Converte response JSON da Asaas em AsaasError.
 * Se body não tiver `errors[]`, cria erro genérico.
 */
export async function parseAsaasErrorResponse(
  res: Response,
  endpoint: string
): Promise<AsaasError> {
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    body = { errors: [{ code: "unknown", description: await res.text() }] };
  }

  const errors: AsaasErrorDetail[] = Array.isArray(body.errors)
    ? body.errors.map((e: any) => ({
        code: e.code ?? "unknown",
        description: translateAsaasError(e.code ?? "", e.description ?? ""),
      }))
    : [
        {
          code: "unknown",
          description: body.message ?? `HTTP ${res.status}`,
        },
      ];

  return new AsaasError({
    status: res.status,
    errors,
    endpoint,
  });
}
