import { ClicksignError } from "./client";

/**
 * Limite de plano da ClickSign — a ÚNICA negativa legítima por falta de
 * envelope.
 *
 * Antes a plataforma mantinha um teto de gasto próprio, em reais, calculado
 * sobre uma tabela de preços chutada no código: o envio era barrado com
 * "R$ 93 de R$ 100" sem que a conta ClickSign tivesse estourado nada. Número
 * inventado, bloqueio inventado. Quem sabe se há envelope disponível é a
 * ClickSign, e ela só responde quando perguntada — por isso este erro nasce da
 * RESPOSTA dela, não de uma conta local feita antes de chamar.
 */
export class EnvelopePlanLimitError extends Error {
  readonly code = "CLICKSIGN_PLAN_LIMIT";

  constructor(
    /** Status HTTP que a ClickSign devolveu — só para log. */
    readonly clicksignStatus?: number
  ) {
    super(
      "A conta ClickSign não tem envelopes disponíveis no plano atual. " +
        "Verifique o plano na ClickSign e tente novamente."
    );
    this.name = "EnvelopePlanLimitError";
  }
}

/**
 * Termos que a ClickSign usa para dizer "acabou" — em pt e en, porque a API
 * mistura os dois conforme o endpoint.
 */
const QUOTA_TERMS =
  /limite|limit|quota|cota|plano|plan|saldo|balance|exceed|excedid|insufficient|insuficiente|upgrade/i;

/** Status que podem carregar um erro de cota (402 é sempre; os outros dependem
 *  do texto — 422/403 também são validação e permissão comuns). */
const AMBIGUOUS_STATUSES = new Set([403, 422]);

/**
 * A ClickSign não documenta publicamente o código de "plano esgotado", então a
 * detecção é deliberadamente conservadora: 402 conta sozinho; 403/422 só contam
 * quando o texto do erro fala de limite. Qualquer outra coisa continua sendo
 * falha genérica — errar para o lado de "erro genérico" mostra uma mensagem
 * ruim; errar para o lado de "limite do plano" reintroduz o bug original,
 * mandando o corretor conferir um plano que está intacto.
 *
 * Todo 4xx de envio é logado cru por `logClicksignFailure` para calibrar isto
 * com um caso real.
 */
export function isPlanQuotaError(err: unknown): err is ClicksignError {
  if (!(err instanceof ClicksignError)) return false;
  if (err.status === 402) return true;
  if (!AMBIGUOUS_STATUSES.has(err.status)) return false;
  return QUOTA_TERMS.test(errorText(err));
}

/** Mensagem + code/title/detail do corpo JSON:API, achatados para o regex. */
function errorText(err: ClicksignError): string {
  const parts: string[] = [err.message];
  const body = err.body;
  if (body && typeof body === "object") {
    const errs = (body as { errors?: unknown }).errors;
    if (Array.isArray(errs)) {
      for (const e of errs) {
        if (!e || typeof e !== "object") continue;
        const { code, title, detail } = e as Record<string, unknown>;
        for (const v of [code, title, detail]) {
          if (typeof v === "string") parts.push(v);
        }
      }
    }
  }
  return parts.join(" ");
}

/**
 * Log do erro CRU de envio. A classificação acima é uma aposta até vermos uma
 * recusa real de plano em produção — sem o corpo no log, não há como afinar o
 * regex depois.
 */
export function logClicksignFailure(context: string, err: unknown): void {
  if (!(err instanceof ClicksignError)) return;
  if (err.status < 400 || err.status >= 500) return;
  console.warn(`[clicksign] falha ${err.status} em ${context}`, {
    status: err.status,
    message: err.message,
    body: err.body,
    classifiedAsPlanLimit: isPlanQuotaError(err),
  });
}
