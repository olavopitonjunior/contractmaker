/**
 * J.3 (Phase J, 2026-04-18) — classificação rica do resultado de uma
 * chamada Infosimples em um dos estados semânticos usados pelo UI e pelo
 * cron de retry.
 *
 * Princípios:
 * 1. Nunca produzir "skipped" por falha — toda certidão solicitada é
 *    tentada; se falhar permanentemente, vira `failed_permanent` com
 *    `portalUrl` para extração manual.
 * 2. Estados transitórios (api_error, portal_unavailable, rate_limited)
 *    agendam retry automático pelo cron; quando max atinge, vira
 *    `failed_permanent`.
 * 3. Estados de dados ruins (data_missing, data_invalid) NÃO retry auto —
 *    o usuário precisa complementar pelo EditPartyDialog.
 * 4. `informativo` identifica endpoints que não emitem certidão (Receita
 *    CNPJ, CRF FGTS) — label distinto na UI.
 */

import type {
  InfosimplesResponse,
  NormalizedResult,
  Situacao,
  FailureCategory,
} from "./types";
import type { EndpointInfo } from "./endpoints";
import { CATEGORIES_REQUIRING_PDF } from "./endpoints";

export type RichStatus =
  | "queued"
  | "fetching"
  | "awaiting_portal"
  | "api_error"
  | "portal_unavailable"
  | "rate_limited"
  | "data_missing"
  | "data_invalid"
  | "success"
  | "informativo"
  | "failed_permanent"
  | "skipped"
  | "replaced";

export interface ClassifiedOutcome {
  status: RichStatus;
  errorMessage: string | null;
  failureCategory: FailureCategory | null;
  costCents: number; // 0 em falhas, info.costCents em success/informativo
  nextRetryAt: Date | null;
  missingFields: string[];
  portalUrl: string | null;
}

/**
 * Backoff por categoria. Tenta 3x (ou max do job) antes de desistir.
 */
const BACKOFF_MS: Record<string, number[]> = {
  api_error: [30_000, 2 * 60_000, 10 * 60_000], // 30s / 2min / 10min
  portal_unavailable: [10 * 60_000, 30 * 60_000, 2 * 60 * 60_000], // 10min / 30min / 2h
  rate_limited: [30 * 60_000, 60 * 60_000], // 30min / 1h
};

/**
 * Parse do code_message da Infosimples para extrair quais campos faltam.
 * Ex: "Parâmetros obrigatórios: data_nascimento, nome_mae"
 * Ex: "O campo CPF é inválido"
 */
export function parseMissingFields(codeMessage: string | null): string[] {
  if (!codeMessage) return [];
  const msg = codeMessage.toLowerCase();
  const fields: string[] = [];
  // Matcher 1: "Parâmetros obrigatórios: X, Y" (Infosimples 606)
  const colon = codeMessage.match(/obrigat[oó]rios?:?\s*([a-z_, ]+)/i);
  if (colon?.[1]) {
    const list = colon[1].split(/[,\s]+/).filter(Boolean);
    fields.push(...list.map((s) => s.toLowerCase().trim()));
  }
  // Matcher 2: mensagens específicas que indicam um campo
  if (/cpf.*(inv[aá]lido|incorret|formato)/i.test(msg)) fields.push("cpf");
  if (/cnpj.*(inv[aá]lido|incorret|formato)/i.test(msg)) fields.push("cnpj");
  if (/(nascimento|birthdate).*(inv[aá]lido|incorret|divergente|n[aã]o confere|obrigat)/i.test(msg))
    fields.push("data_nascimento");
  if (/(nome).*(inv[aá]lido|n[aã]o confere|divergente)/i.test(msg))
    fields.push("nome");
  if (/(nome.*m[aã]e|filia[cç][aã]o)/i.test(msg)) fields.push("nome_mae");
  if (/(rg|identidade)/i.test(msg) && /inv[aá]lido|obrigat/i.test(msg))
    fields.push("rg");
  return [...new Set(fields)].filter((f) => f.length > 1);
}

/**
 * Classifica o outcome de uma chamada Infosimples em estado rico + retry plan.
 */
export function classifyOutcome(
  resp: InfosimplesResponse,
  normalized: NormalizedResult,
  info: EndpointInfo,
  opts: {
    attachmentId: string | null;
    retryAttempts: number;
    maxRetries: number;
  }
): ClassifiedOutcome {
  const situacao = normalized.situacao as Situacao | undefined;
  const category = normalized.failureCategory ?? null;
  const billable = resp.header?.billable;
  const portalUrl = info.portalUrl ?? null;

  // Endpoints informativos (cadastro, fgts) — Receita CNPJ, CRF
  if (info.category === "cadastro" || info.category === "fgts") {
    if (resp.code === 200) {
      return {
        status: "informativo",
        errorMessage: null,
        failureCategory: null,
        costCents: billable === false ? 0 : info.costCents,
        nextRetryAt: null,
        missingFields: [],
        portalUrl,
      };
    }
    // Código errado em endpoint informativo cai em api_error
  }

  // Sucesso tradicional (certidão emitida)
  if (resp.code === 200) {
    const requiresPdf =
      info.emitsPdf === false
        ? false
        : CATEGORIES_REQUIRING_PDF.has(info.category);
    const missingRequiredPdf =
      requiresPdf &&
      opts.attachmentId === null &&
      (situacao === "negativa" ||
        situacao === "positiva" ||
        situacao === "positiva_com_efeitos" ||
        situacao === "nao_emitida");
    if (missingRequiredPdf) {
      // Portal OK mas não anexou PDF — retry como portal_unavailable
      return planRetry(
        "portal_unavailable",
        "Portal respondeu mas não anexou o PDF — retry agendado",
        "portal_unavailable",
        opts,
        portalUrl
      );
    }
    // code 200 com situação válida → success legítimo
    return {
      status: "success",
      errorMessage: null,
      failureCategory: null,
      costCents: billable === false ? 0 : info.costCents,
      nextRetryAt: null,
      missingFields: [],
      portalUrl,
    };
  }

  // Falhas (code !== 200) — rotear por categoria
  switch (category) {
    case "missing_input": {
      const parsed = parseMissingFields(resp.code_message);
      // I.6 (2026-05-11) — quando o provedor manda mensagem genérica sem
      // nome de campo (TJSP code 606 padrão: "Parâmetros obrigatórios não
      // foram enviados. Por favor, verifique a documentação"), parseMissingFields
      // não consegue extrair nada. Sem detalhe a UI ficaria em "Faltam dados"
      // sem botão "Complementar" — beco sem saída. Se há portalUrl cacheada,
      // escala pra failed_permanent + CTA "use o portal oficial".
      if (parsed.length === 0 && portalUrl) {
        return {
          status: "failed_permanent",
          errorMessage: resp.code_message
            ? `${resp.code_message} (provedor não detalhou os campos faltantes)`
            : "Provedor recusou — emita no portal oficial",
          failureCategory: category, // mantém "missing_input" pra analytics
          costCents: 0,
          nextRetryAt: null,
          missingFields: [],
          portalUrl,
        };
      }
      return {
        status: "data_missing",
        errorMessage: resp.code_message,
        failureCategory: category,
        costCents: 0,
        nextRetryAt: null, // não retry auto — user action
        missingFields: parsed,
        portalUrl,
      };
    }
    case "inconsistent_input":
      return {
        status: "data_invalid",
        errorMessage: resp.code_message,
        failureCategory: category,
        costCents: 0,
        nextRetryAt: null,
        missingFields: parseMissingFields(resp.code_message),
        portalUrl,
      };
    case "rate_limited":
      return planRetry(
        "rate_limited",
        resp.code_message,
        "rate_limited",
        opts,
        portalUrl
      );
    case "portal_unavailable":
      return planRetry(
        "portal_unavailable",
        resp.code_message,
        "portal_unavailable",
        opts,
        portalUrl
      );
    case "provider_timeout":
      return planRetry(
        "api_error",
        resp.code_message,
        "api_error",
        opts,
        portalUrl
      );
    case "integration_error":
      // Code 602 (URL inválida) = endpoint depreciado — falha permanente,
      // não adianta retry. Usuário vê CTA portal oficial.
      return {
        status: "failed_permanent",
        errorMessage:
          resp.code_message ||
          "Endpoint depreciado pelo provedor — use o portal oficial",
        failureCategory: category,
        costCents: 0,
        nextRetryAt: null,
        missingFields: [],
        portalUrl,
      };
    case "account_issue":
      // Saldo / token — failed_permanent mas sem portalUrl (admin action)
      return {
        status: "failed_permanent",
        errorMessage: resp.code_message || "Problema na conta do provedor",
        failureCategory: category,
        costCents: 0,
        nextRetryAt: null,
        missingFields: [],
        portalUrl: null,
      };
    case "genuine_no_data":
      // Portal confirmou ausência mas não emitiu PDF — retry uma vez
      // (pode ter sido glitch) depois vira success negativa sem PDF
      if (opts.retryAttempts === 0) {
        return planRetry(
          "portal_unavailable",
          resp.code_message,
          "portal_unavailable",
          opts,
          portalUrl
        );
      }
      return {
        status: "success",
        errorMessage: null,
        failureCategory: null,
        costCents: billable === false ? 0 : info.costCents,
        nextRetryAt: null,
        missingFields: [],
        portalUrl,
      };
    default:
      // Unknown — trata como api_error pra retry
      return planRetry(
        "api_error",
        resp.code_message ||
          `Código ${resp.code} não reconhecido — retry agendado`,
        "api_error",
        opts,
        portalUrl
      );
  }
}

function planRetry(
  status: RichStatus,
  message: string | null,
  backoffKey: keyof typeof BACKOFF_MS,
  opts: { retryAttempts: number; maxRetries: number },
  portalUrl: string | null
): ClassifiedOutcome {
  const backoffs = BACKOFF_MS[backoffKey] ?? [];
  const attempt = opts.retryAttempts;
  const hasMore = attempt < opts.maxRetries && attempt < backoffs.length;
  if (!hasMore) {
    return {
      status: "failed_permanent",
      errorMessage:
        message ?? "Falhas consecutivas esgotaram as tentativas automáticas",
      failureCategory:
        backoffKey === "api_error"
          ? "provider_timeout"
          : backoffKey === "portal_unavailable"
          ? "portal_unavailable"
          : "rate_limited",
      costCents: 0,
      nextRetryAt: null,
      missingFields: [],
      portalUrl,
    };
  }
  const delayMs = backoffs[attempt] ?? backoffs[backoffs.length - 1];
  return {
    status,
    errorMessage: message ?? null,
    failureCategory:
      backoffKey === "api_error"
        ? "provider_timeout"
        : backoffKey === "portal_unavailable"
        ? "portal_unavailable"
        : "rate_limited",
    costCents: 0,
    nextRetryAt: new Date(Date.now() + delayMs),
    missingFields: [],
    portalUrl,
  };
}
