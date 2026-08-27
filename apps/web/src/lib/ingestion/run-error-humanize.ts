/**
 * Traduz o `IngestionRun.error` para o operador — na LEITURA, não na gravação.
 *
 * O erro gravado continua sendo o técnico (é ele que depuração e suporte
 * precisam; o `console.error` do executor já registra request_id e tipo). O que
 * não pode acontecer de novo é o que o lote de 20 fez: despejar
 * `A resposta do modelo não é JSON válido: {"templates":[{"sourceItemId"...`
 * na tela de um operador de onboarding, que não tem o que fazer com payload.
 *
 * Módulo puro e client-safe — quem usa é a tela de revisão.
 */

export interface HumanRunError {
  /** A frase mostrada com destaque. */
  message: string;
  /** O que o operador pode FAZER — casa com o botão "Tentar de novo". */
  action: string;
  /** true quando o botão de replanejar resolve (erro transitório/de tamanho). */
  retryable: boolean;
}

const RULES: Array<{ test: RegExp; human: HumanRunError }> = [
  {
    test: /cortada no limite de tokens|não é JSON válido|max_tokens/i,
    human: {
      message: "A proposta ficou grande demais e veio cortada pelo caminho.",
      action:
        "Clique em “Tentar de novo” — o sistema reanalisa por partes, sem reenviar arquivo nenhum.",
      retryable: true,
    },
  },
  {
    test: /demorou|timeout|timed out|maxDuration|não coube no tempo/i,
    human: {
      message: "A análise demorou mais do que o previsto e foi interrompida.",
      action:
        "Clique em “Tentar de novo”. Se repetir, envie o acervo em lotes menores por tipo de contrato.",
      retryable: true,
    },
  },
  {
    test: /teto de custo|cost cap|INGESTION_RUN_MAX_USD/i,
    human: {
      message: "Este lote atingiu o teto de custo de análise configurado.",
      action:
        "Fale com o suporte para ampliar o teto — nada do que já foi lido se perde.",
      retryable: false,
    },
  },
  {
    test: /degraus de planejamento|degraus e não coube/i,
    human: {
      message:
        "A análise tentou o número máximo de vezes sem chegar a uma proposta.",
      action:
        "Envie o acervo em lotes menores por tipo de contrato, ou fale com o suporte.",
      retryable: false,
    },
  },
  {
    test: /recusada pela API|invalid_request|defeito da requisição/i,
    human: {
      message: "Um defeito nosso interrompeu a análise — não foi nada do seu acervo.",
      action:
        "O time já enxerga este erro. Tente de novo mais tarde; os arquivos ficam guardados.",
      retryable: true,
    },
  },
  {
    test: /429|rate limit|overloaded|5\d{2}|ECONNRESET|fetch failed/i,
    human: {
      message: "O serviço de análise ficou instável no meio do lote.",
      action: "Clique em “Tentar de novo” — costuma resolver na hora.",
      retryable: true,
    },
  },
];

const FALLBACK: HumanRunError = {
  message: "A análise parou por um erro inesperado.",
  action:
    "Clique em “Tentar de novo”. Se repetir, fale com o suporte — os arquivos e o que já foi lido ficam guardados.",
  retryable: true,
};

/** null quando não há erro nenhum. */
export function humanizeRunError(raw: string | null | undefined): HumanRunError | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.human;
  }
  return FALLBACK;
}
