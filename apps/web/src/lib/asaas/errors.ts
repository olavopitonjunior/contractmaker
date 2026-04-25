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
  invalid_billingType: "Método de cobrança indisponível para esta subconta",
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

/**
 * Heurísticas baseadas no conteúdo da `description` retornada pela Asaas.
 * Aplicadas ANTES do match por código, porque alguns erros chegam com
 * `code` genérico (ex: `invalid_billingType`) mas a causa real está no
 * texto (ex: "limite de emissão atingido"). Retorna null se nada matcha.
 */
function translateByDescription(description: string | undefined): string | null {
  if (!description) return null;
  const lc = description.toLowerCase();

  // Limite de emissão atingido (disparado em PIX e boleto quando subconta atinge teto)
  if (
    lc.includes("limite") &&
    (lc.includes("emiss") || lc.includes("cobran") || lc.includes("r$"))
  ) {
    return `Limite de emissão atingido. ${description.trim()}`;
  }

  // Subconta ainda em análise / documentação pendente
  if (lc.includes("análise") || lc.includes("analise") || lc.includes("pendente")) {
    if (lc.includes("document") || lc.includes("subconta") || lc.includes("conta")) {
      return "Sua subconta ainda está em análise ou com documentação pendente. Verifique o status em Configurações → Pagamentos.";
    }
  }

  // CPF/CNPJ já cadastrado
  if (lc.includes("já cadastrado") || lc.includes("ja cadastrado") || lc.includes("já existe")) {
    return description.trim();
  }

  // Saldo insuficiente
  if (lc.includes("saldo") && (lc.includes("insuficiente") || lc.includes("indispon"))) {
    return "Saldo insuficiente para esta operação.";
  }

  return null;
}

export function translateAsaasError(code: string, description: string): string {
  const byDesc = translateByDescription(description);
  if (byDesc) return byDesc;
  return CODE_TRANSLATIONS[code] ?? description ?? code;
}

/**
 * Converte response JSON da Asaas em AsaasError.
 * Se body não tiver `errors[]`, cria erro genérico.
 *
 * Importante: lê o body como texto UMA vez (response body é stream
 * de uso único). Tenta JSON.parse — se falhar, usa o texto cru como
 * description. Evita "Body is unusable: Body has already been read".
 */
export async function parseAsaasErrorResponse(
  res: Response,
  endpoint: string
): Promise<AsaasError> {
  const rawText = await res.text().catch(() => "");
  let body: any = {};
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = {
        errors: [
          { code: "unknown", description: rawText.slice(0, 500) || `HTTP ${res.status}` },
        ],
      };
    }
  } else {
    body = { errors: [{ code: "unknown", description: `HTTP ${res.status}` }] };
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
