/**
 * O que cada família de modelo aceita nos parâmetros de RACIOCÍNIO.
 *
 * ## Por que isto existe
 *
 * `runStructured` mandava `thinking: {type:"adaptive"}` em toda chamada, como se
 * os modelos fossem intercambiáveis. Eles não são — os parâmetros de raciocínio
 * mudaram entre gerações, e o terceiro 400 do run de ingestão foi exatamente
 * isso:
 *
 * ```
 * adaptive thinking is not supported on this model
 * request_id=req_011CeQAUDeoHXkcoR4pA3NxW
 * ```
 *
 * O planner (`claude-opus-4-8`) PRECISA do `thinking` explícito — nele, omitir
 * significa rodar sem raciocínio nenhum. O classificador (`claude-haiku-4-5`) é
 * da geração anterior e não tem adaptativo. O mesmo parâmetro é obrigatório num
 * e proibido no outro, e não há como descobrir isso em typecheck.
 *
 * ## Como a tabela é lida
 *
 * Por PREFIXO do id, porque convivem no repo ids canônicos
 * (`claude-haiku-4-5`) e ids com sufixo de data (`claude-haiku-4-5-20251001`,
 * em `HAIKU_MODEL`), e os dois são o mesmo modelo. A ordem importa: entradas
 * mais específicas primeiro (`claude-opus-4-8` antes de `claude-opus-4`).
 *
 * ## Procedência — confirmado, documentado, deduzido
 *
 * Mesma disciplina de `schema-lint.ts`, com um degrau a mais. Aqui existe uma
 * fonte que lá não existia (a referência de parâmetros da API), então
 * "documentado" fica separado de "deduzido": quem mexer precisa saber se está
 * diante de um 400 que nós vimos, de uma linha da referência, ou de uma
 * inferência nossa.
 */

import type { EffortLevel } from "@/lib/ai/shared/anthropic-structured";

/** De onde veio a informação de uma linha da tabela. */
export type EvidenceSource =
  /** A API respondeu 400 para NÓS, com request_id. */
  | "confirmed"
  /** A referência de parâmetros da Anthropic declara o comportamento. */
  | "documented"
  /** Inferência a partir da geração do modelo. Sem erro nem documento. */
  | "deduced";

export interface Evidence {
  source: EvidenceSource;
  note: string;
}

export interface ModelCapabilities {
  /** Rótulo da família, para mensagem de erro legível. */
  family: string;
  /** Aceita `thinking: {type:"adaptive"}`. */
  adaptiveThinking: boolean;
  /**
   * Níveis de `output_config.effort` aceitos. Lista VAZIA = o modelo não aceita
   * `effort` nenhum — não é "aceita o default", é 400.
   */
  effortLevels: readonly EffortLevel[];
  thinkingEvidence: Evidence;
  effortEvidence: Evidence;
}

const ALL_EFFORTS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** `xhigh` só chegou no Opus 4.7 — a família 4.6 não o conhece. */
const EFFORTS_WITHOUT_XHIGH: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "max",
];

const MODERN: Pick<
  ModelCapabilities,
  "adaptiveThinking" | "effortLevels" | "thinkingEvidence" | "effortEvidence"
> = {
  adaptiveThinking: true,
  effortLevels: ALL_EFFORTS,
  thinkingEvidence: {
    source: "documented",
    note: "família 4.7+ usa thinking adaptativo; `budget_tokens` responde 400.",
  },
  effortEvidence: {
    source: "documented",
    note: "`output_config.effort` aceita low…max.",
  },
};

/**
 * Tabela por prefixo, do mais específico para o mais genérico.
 *
 * Só entram famílias que este repo pode alcançar — não é um catálogo da API.
 * Modelo fora da lista cai no comportamento conservador de
 * {@link capabilitiesFor}.
 */
const TABLE: ReadonlyArray<{ prefix: string; caps: ModelCapabilities }> = [
  { prefix: "claude-opus-4-8", caps: { family: "Opus 4.8", ...MODERN } },
  { prefix: "claude-opus-4-7", caps: { family: "Opus 4.7", ...MODERN } },
  { prefix: "claude-opus-5", caps: { family: "Opus 5", ...MODERN } },
  { prefix: "claude-sonnet-5", caps: { family: "Sonnet 5", ...MODERN } },
  { prefix: "claude-fable-5", caps: { family: "Fable 5", ...MODERN } },
  {
    prefix: "claude-opus-4-6",
    caps: {
      family: "Opus 4.6",
      adaptiveThinking: true,
      effortLevels: EFFORTS_WITHOUT_XHIGH,
      thinkingEvidence: {
        source: "documented",
        note: "4.6 aceita adaptativo (e ainda aceita `budget_tokens`, que não usamos).",
      },
      effortEvidence: {
        source: "documented",
        note: "`xhigh` só existe a partir do Opus 4.7.",
      },
    },
  },
  {
    prefix: "claude-sonnet-4-6",
    caps: {
      family: "Sonnet 4.6",
      adaptiveThinking: true,
      effortLevels: EFFORTS_WITHOUT_XHIGH,
      thinkingEvidence: {
        source: "documented",
        note: "4.6 aceita adaptativo.",
      },
      effortEvidence: {
        source: "documented",
        note: "`xhigh` só existe a partir do Opus 4.7.",
      },
    },
  },
  {
    prefix: "claude-haiku-4-5",
    caps: {
      family: "Haiku 4.5",
      adaptiveThinking: false,
      effortLevels: [],
      thinkingEvidence: {
        source: "confirmed",
        note:
          'HTTP 400 "adaptive thinking is not supported on this model" ' +
          "(request_id=req_011CeQAUDeoHXkcoR4pA3NxW), run de ingestão em staging.",
      },
      effortEvidence: {
        source: "documented",
        note:
          "`output_config.effort` responde erro em Haiku 4.5 e Sonnet 4.5 — " +
          "só não estourou antes porque o `thinking` falha primeiro.",
      },
    },
  },
  {
    prefix: "claude-sonnet-4-5",
    caps: {
      family: "Sonnet 4.5",
      adaptiveThinking: false,
      effortLevels: [],
      thinkingEvidence: {
        source: "documented",
        note: "geração anterior ao 4.6: raciocínio estendido era `budget_tokens`.",
      },
      effortEvidence: {
        source: "documented",
        note: "`effort` responde erro em Sonnet 4.5.",
      },
    },
  },
];

/**
 * O que fazer com um modelo que não está na tabela.
 *
 * ESCOLHA: não mandar nem `thinking` nem `effort`.
 *
 * Os dois são parâmetros OPCIONAIS — omiti-los nunca produz 400 em modelo
 * nenhum, em nenhuma geração. Mandá-los para quem não aceita é justamente o 400
 * que derrubou este run. Então a assimetria decide: o pior caso de omitir é uma
 * chamada que roda com menos raciocínio do que poderia; o pior caso de mandar é
 * o run morto.
 *
 * A objeção honesta é que, num Opus futuro, omitir `thinking` degradaria o plano
 * em silêncio — o mesmo defeito de fallback silencioso que já corrigimos no
 * executor. Duas coisas respondem a isso: a omissão é registrada em log com o id
 * do modelo, e o teste de contrato exige que todo modelo que o código realmente
 * usa esteja na tabela. Um modelo desconhecido em produção significa que alguém
 * trocou uma constante sem passar por aqui — e o teste quebra antes do deploy.
 */
export const CONSERVATIVE_FALLBACK: ModelCapabilities = {
  family: "desconhecida",
  adaptiveThinking: false,
  effortLevels: [],
  thinkingEvidence: {
    source: "deduced",
    note:
      "modelo fora da tabela: omitimos parâmetro de raciocínio porque omitir " +
      "nunca dá 400 e mandar pode dar.",
  },
  effortEvidence: {
    source: "deduced",
    note: "idem — `effort` omitido em modelo desconhecido.",
  },
};

/** O id está na tabela? Usado pelo validador e pelo teste de contrato. */
export function isKnownModel(model: string): boolean {
  return TABLE.some((row) => model.startsWith(row.prefix));
}

/** Capacidades do modelo, ou o fallback conservador se ele for desconhecido. */
export function capabilitiesFor(model: string): ModelCapabilities {
  const row = TABLE.find((entry) => model.startsWith(entry.prefix));
  return row ? row.caps : CONSERVATIVE_FALLBACK;
}

/** O modelo aceita `output_config.effort`? */
export function supportsEffort(caps: ModelCapabilities): boolean {
  return caps.effortLevels.length > 0;
}

/** Todos os prefixos da tabela — o teste de contrato os enumera. */
export function knownModelPrefixes(): string[] {
  return TABLE.map((row) => row.prefix);
}
