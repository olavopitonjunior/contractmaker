import { ClicksignError } from "./client";
import { maskPii } from "@/lib/security/pii";

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
 * "Acabou" — o verbo. Sozinho não basta: "excede o limite de 90 dias" (prazo do
 * envelope) casa aqui e não é cota.
 */
const EXHAUSTION =
  /esgotad|excedid|exceed|atingid|insufficient|insuficient|exhaust|sem\s+saldo|no\s+remaining/i;

/**
 * O QUE acabou. Deliberadamente NÃO inclui "limite" nem "plano" soltos: a
 * ClickSign responde 422 com "não está disponível no seu plano" quando o método
 * de autenticação não está habilitado na conta (ver o passo de requirements em
 * executor.ts e o fallback já existente em proposals/send-execute.ts). Casar
 * "plano" cru transformaria esse erro em "sem envelopes disponíveis" — que é
 * exatamente a mensagem falsa que este módulo existe pra eliminar.
 */
const QUOTA_SUBJECT =
  /envelope|documento|document|cota|quota|saldo|balance|cr[ée]dito|credit|assinatura(s)?\s+dispon/i;

const AMBIGUOUS_STATUSES = new Set([403, 422]);

/**
 * A ClickSign não documenta publicamente o código de "plano esgotado", então a
 * detecção é deliberadamente conservadora: 402 conta sozinho; 403/422 só contam
 * quando o texto traz o verbo E o objeto ("limite de DOCUMENTOS do plano
 * ATINGIDO"). Qualquer outra coisa continua sendo falha genérica.
 *
 * O viés é proposital. Errar para "erro genérico" custa uma mensagem ruim;
 * errar para "limite do plano" reintroduz o bug original, mandando o corretor
 * conferir um plano que está intacto. Na dúvida, NÃO é cota.
 *
 * `logClicksignFailure` grava o corpo (com PII mascarada) de todo 4xx de envio
 * pra que isto seja calibrado com um caso real em vez de com palpite.
 */
export function isPlanQuotaError(err: unknown): err is ClicksignError {
  if (!(err instanceof ClicksignError)) return false;
  if (err.status === 402) return true;
  if (!AMBIGUOUS_STATUSES.has(err.status)) return false;
  const text = errorText(err);
  return EXHAUSTION.test(text) && QUOTA_SUBJECT.test(text);
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
 * Log do erro CRU de envio, com PII mascarada. A classificação acima é uma
 * aposta até vermos uma recusa real de plano em produção — sem o corpo no log
 * não há como afinar os regexes depois.
 *
 * O mascaramento não é opcional: os 422 de validação da ClickSign ecoam o
 * atributo recusado, então um erro em `addSigner` despejaria e-mail, telefone e
 * CPF do signatário em texto puro no log do Vercel.
 */
export function logClicksignFailure(context: string, err: unknown): void {
  if (!(err instanceof ClicksignError)) return;
  if (err.status < 400 || err.status >= 500) return;
  console.warn(`[clicksign] falha ${err.status} em ${context}`, {
    status: err.status,
    message: maskPii(err.message),
    body: maskPii(safeStringify(err.body)),
    classifiedAsPlanLimit: isPlanQuotaError(err),
  });
}

function safeStringify(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return "[corpo não serializável]";
  }
}
