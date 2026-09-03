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
import {
  isProtestoNadaConsta,
  isSemResultadoInformativo,
  isEmailThrottle,
  isReceitaCertidaoNaoEmitida,
  isPortalUnavailableMessage,
  isTokenAuthFailure,
  friendlySourceUnavailableMessage,
  terminalizeRetryMessage,
} from "./error-codes";

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
  | "duplicate_pending"
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
  // 2026-06-01 — throttle de e-mail do e-SAJ (TJSP pedido-certidao, code 604
  // "mesmo email múltiplas vezes"): vários pedidos do mesmo deal usam o MESMO
  // email e colidem. Precisa de janela MAIS LONGA e MAIS tentativas que o
  // rate_limited genérico, e os retries dos ~6 pedidos têm que ser ESPALHADOS
  // (jitter por jobId) pra não recolidirem no mesmo tick de cron.
  rate_limited_email: [10 * 60_000, 20 * 60_000, 40 * 60_000, 90 * 60_000, 3 * 60 * 60_000],
};

// Espalhamento determinístico (sem Math.random) do retry de email-throttle:
// hash FNV-1a do jobId → offset 0..spanMs. Mantém o job A sempre deslocado do
// job B em todos os rounds, evitando que os pedidos TJSP do mesmo email caiam
// no mesmo tick de cron e recolidam no e-SAJ.
function jitterMs(jobId: string | undefined, spanMs: number): number {
  if (!jobId) return 0;
  let h = 2166136261;
  for (let i = 0; i < jobId.length; i++) {
    h ^= jobId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % spanMs;
}

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
    jobId?: string;
  }
): ClassifiedOutcome {
  const situacao = normalized.situacao as Situacao | undefined;
  const category = normalized.failureCategory ?? null;
  const billable = resp.header?.billable;
  const portalUrl = info.portalUrl ?? null;
  // 2026-05-26 — preço REAL cobrado (header.price em BRL) vira o custo do job;
  // fallback na estimativa estática do catálogo quando ausente. Corrige
  // orçamento/histórico e alimenta a estimativa observada do /plan.
  const chargedCostCents =
    typeof resp.header?.price === "number" && resp.header.price > 0
      ? Math.round(resp.header.price * 100)
      : info.costCents;
  // I.7 (2026-05-11) — Infosimples retorna detalhe específico do erro no
  // array `errors[]`. O normalizer já consolidou tudo em `normalized.detalhes`
  // (errors[] + code_message). Usa esse texto rico como errorMessage em vez
  // do code_message genérico.
  const effectiveErrorMessage = normalized.detalhes ?? resp.code_message;

  // Endpoints informativos (cadastro, fgts) — Receita CNPJ, CRF
  if (info.category === "cadastro" || info.category === "fgts") {
    if (resp.code === 200) {
      return {
        status: "informativo",
        errorMessage: null,
        failureCategory: null,
        costCents: billable === false ? 0 : chargedCostCents,
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
      costCents: billable === false ? 0 : chargedCostCents,
      nextRetryAt: null,
      missingFields: [],
      portalUrl,
    };
  }

  // CENPROT/IEPTB "não constam protestos" — chega como 6xx (sem PDF), mas é
  // uma negativa legítima, não uma falha. Fecha como success (verde "nada
  // consta"); o normalizer já marcou situacao "negativa". Gated na mensagem
  // explícita + endpoint de protesto — ver isProtestoNadaConsta. Custo honesto
  // (respeita billable). Decisão de produto 2026-05-21: exceção consciente ao
  // anti-falso-negativo (negativa sem PDF) só pra este caso bem identificado.
  const protestoMsg = [resp.code_message, ...(resp.errors ?? [])]
    .filter(Boolean)
    .join(" ");
  if (
    isProtestoNadaConsta(info.id, protestoMsg) ||
    isProtestoNadaConsta(info.id, effectiveErrorMessage)
  ) {
    return {
      status: "success",
      errorMessage: null,
      failureCategory: null,
      costCents: billable === false ? 0 : chargedCostCents,
      nextRetryAt: null,
      missingFields: [],
      portalUrl,
    };
  }

  // Endpoints informativos (emitsPdf:false, ex. tribunal/tjsp/eproc-lista)
  // sinalizam "sem processos" como 6xx (612 "Nenhum Resultado Encontrado").
  // Como não emitem PDF, é negativa informativa legítima — fecha como success
  // (verde "nada consta") em vez de missing_input → failed_permanent (vermelho).
  // Gated em emitsPdf===false + mensagem de ausência — ver isSemResultadoInformativo.
  if (
    info.emitsPdf === false &&
    (isSemResultadoInformativo(protestoMsg) ||
      isSemResultadoInformativo(effectiveErrorMessage))
  ) {
    return {
      status: "success",
      errorMessage: null,
      failureCategory: null,
      costCents: billable === false ? 0 : chargedCostCents,
      nextRetryAt: null,
      missingFields: [],
      portalUrl,
    };
  }

  // Receita Federal / PGFN "informações insuficientes para emitir a certidão
  // pela Internet" (tipicamente 611): NÃO é erro nosso nem "nada consta" — é a
  // RFB recusando a emissão ONLINE (situação cadastral/pendência). Tratar como
  // NÃO-EMISSÃO terminal → portal oficial. Custo honesto (RFB cobra: respeita
  // billable). Sem isto, caía em inconsistent_input → data_invalid ("corrija os
  // dados"), enganoso pois não há dado nosso a corrigir. Decisão 2026-06-02.
  if (
    (info.id.includes("pgfn") || info.id.includes("receita")) &&
    (isReceitaCertidaoNaoEmitida(effectiveErrorMessage) ||
      isReceitaCertidaoNaoEmitida(resp.code_message))
  ) {
    return {
      status: "failed_permanent",
      errorMessage:
        "A Receita Federal não emite esta certidão pela Internet para este contribuinte (situação cadastral ou pendência). Emita no portal oficial.",
      // provedor/condição da fonte — não é bug nosso (integração) nem dado do
      // form a corrigir (inconsistent_input). genuine_no_data fica no grupo
      // "provedor" do FAILURE_GROUP; aqui só alimenta analytics (retornamos
      // failed_permanent direto, sem passar pelo switch de categoria).
      failureCategory: "genuine_no_data",
      costCents: billable === false ? 0 : chargedCostCents,
      nextRetryAt: null,
      missingFields: [],
      portalUrl,
    };
  }

  // Falhas (code !== 200) — rotear por categoria
  switch (category) {
    case "missing_input": {
      // I.7 — parseMissingFields agora vê texto consolidado (errors[] +
      // code_message). Pra TJSP 606 atual, errors=["CPF e senha gov.br..."]
      // não casa com nenhuma heurística de fieldname, então parsed=[] e
      // cai no fallback failed_permanent + portal (mensagem fica rica via
      // effectiveErrorMessage, não mais genérica).
      const parsed = parseMissingFields(effectiveErrorMessage);
      if (parsed.length === 0 && portalUrl) {
        return {
          status: "failed_permanent",
          errorMessage: effectiveErrorMessage || "Provedor recusou — emita no portal oficial",
          failureCategory: category, // mantém "missing_input" pra analytics
          costCents: 0,
          nextRetryAt: null,
          missingFields: [],
          portalUrl,
        };
      }
      return {
        status: "data_missing",
        errorMessage: effectiveErrorMessage,
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
        errorMessage: effectiveErrorMessage,
        failureCategory: category,
        costCents: 0,
        nextRetryAt: null,
        missingFields: parseMissingFields(effectiveErrorMessage),
        portalUrl,
      };
    case "rate_limited": {
      // 604 throttle de e-mail do e-SAJ usa backoff dedicado (mais longo +
      // mais tentativas + jitter). Demais rate_limited (quota de portal etc.)
      // seguem o backoff genérico.
      const backoffKey = isEmailThrottle(effectiveErrorMessage)
        ? "rate_limited_email"
        : "rate_limited";
      return planRetry(
        "rate_limited",
        effectiveErrorMessage,
        backoffKey,
        opts,
        portalUrl
      );
    }
    case "portal_unavailable": {
      // 615 "site indisponível" / "API pausada / instabilidade na fonte": troca
      // o texto técnico cru do provedor por uma mensagem clara de FONTE OFICIAL
      // fora do ar (não erro de dado). Vale no transitório e no failed_permanent
      // (planRetry reusa `message` ao esgotar retries).
      const portalMsg = isPortalUnavailableMessage(effectiveErrorMessage)
        ? friendlySourceUnavailableMessage(info.label)
        : effectiveErrorMessage;
      return planRetry(
        "portal_unavailable",
        portalMsg,
        "portal_unavailable",
        opts,
        portalUrl
      );
    }
    case "provider_timeout":
      return planRetry(
        "api_error",
        effectiveErrorMessage,
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
          effectiveErrorMessage ||
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
        errorMessage: isTokenAuthFailure(effectiveErrorMessage)
          ? "Token da Infosimples inválido ou não configurado (INFOSIMPLES_TOKEN) — a consulta não rodou e nada foi cobrado. Ação do administrador."
          : effectiveErrorMessage || "Problema na conta do provedor",
        failureCategory: category,
        costCents: 0,
        nextRetryAt: null,
        missingFields: [],
        portalUrl: null,
      };
    case "genuine_no_data": {
      // I.8 (2026-05-12) — Infosimples às vezes retorna code 600 com
      // code_message "Um erro inesperado ocorreu e será analisado" +
      // billable=false (não cobra) em vez de erro explícito. Antes virava
      // success negativa direto, gerando jobs sem PDF mas marcados como
      // emitidos — falso positivo.
      //
      // Pra endpoints que EXIGEM PDF (civel/trabalhista/fiscal/protesto/
      // municipal/federal — definido em CATEGORIES_REQUIRING_PDF), success
      // sem attachment é inaceitável. Retry com backoff portal_unavailable
      // até esgotar — aí vira failed_permanent + CTA portal.
      const requiresPdf =
        info.emitsPdf === false
          ? false
          : CATEGORIES_REQUIRING_PDF.has(info.category);
      if (requiresPdf && opts.attachmentId === null) {
        // 600 "Um erro inesperado ocorreu" em endpoint que exige PDF (ex.: TRF5):
        // é falha da fonte, não "nada consta". Mensagem clara de fonte indisponível.
        return planRetry(
          "portal_unavailable",
          friendlySourceUnavailableMessage(info.label),
          "portal_unavailable",
          opts,
          portalUrl
        );
      }
      // Endpoints informativos / sem PDF obrigatório: só fecham como negativa
      // quando a resposta TRAZ evidência de ausência ("nada consta", "nenhum
      // resultado", "não encontrado"). Code 600 "Um erro inesperado ocorreu"
      // cai nesta categoria pelo CODE_MAP sem evidência nenhuma — fechar como
      // success exibia "Negativa · nada consta" pra consulta que nunca rodou
      // (E-Proc ×2, deal cmpypeb95, 2026-06-10). Sem evidência: retry com
      // backoff até esgotar → failed_permanent honesto + CTA portal.
      const noDataMsg = [protestoMsg, effectiveErrorMessage]
        .filter(Boolean)
        .join(" ");
      const noDataEvidence =
        isSemResultadoInformativo(noDataMsg) ||
        /nada\s+consta|n[ãa]o\s+(foi\s+poss[ií]vel\s+)?encontr|nenhum\s+registro|n[ãa]o\s+h[áa]\s/i.test(
          noDataMsg
        );
      if (!noDataEvidence) {
        return planRetry(
          "portal_unavailable",
          friendlySourceUnavailableMessage(info.label),
          "portal_unavailable",
          opts,
          portalUrl
        );
      }
      // Evidência explícita de "nada consta": 1 retry profilático, depois
      // success negativa (fluxo de antes, agora gated na evidência).
      if (opts.retryAttempts === 0) {
        return planRetry(
          "portal_unavailable",
          effectiveErrorMessage,
          "portal_unavailable",
          opts,
          portalUrl
        );
      }
      return {
        status: "success",
        errorMessage: null,
        failureCategory: null,
        costCents: billable === false ? 0 : chargedCostCents,
        nextRetryAt: null,
        missingFields: [],
        portalUrl,
      };
    }
    default:
      // Unknown — trata como api_error pra retry
      return planRetry(
        "api_error",
        effectiveErrorMessage ||
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
  opts: { retryAttempts: number; maxRetries: number; jobId?: string },
  portalUrl: string | null
): ClassifiedOutcome {
  const backoffs = BACKOFF_MS[backoffKey] ?? [];
  const attempt = opts.retryAttempts;
  // Email-throttle precisa de mais tentativas que o maxRetries default (3) —
  // o teto efetivo passa a ser o tamanho do array de backoff (5). Só pra essa
  // chave; as demais respeitam opts.maxRetries.
  const cap =
    backoffKey === "rate_limited_email"
      ? Math.max(opts.maxRetries, backoffs.length)
      : opts.maxRetries;
  const hasMore = attempt < cap && attempt < backoffs.length;
  if (!hasMore) {
    return {
      status: "failed_permanent",
      // terminalizeRetryMessage: a mensagem amigável de instabilidade promete
      // "Nova tentativa automática agendada" — falso aqui (estado terminal).
      errorMessage:
        terminalizeRetryMessage(message) ??
        "Falhas consecutivas esgotaram as tentativas automáticas",
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
  const baseDelay = backoffs[attempt] ?? backoffs[backoffs.length - 1];
  // Jitter só pro email-throttle: espalha os ~6 pedidos TJSP do mesmo email em
  // até 15min pra não recolidirem no mesmo tick de cron (que processa todos os
  // nextRetryAt vencidos juntos).
  const delayMs =
    baseDelay +
    (backoffKey === "rate_limited_email" ? jitterMs(opts.jobId, 15 * 60_000) : 0);
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
