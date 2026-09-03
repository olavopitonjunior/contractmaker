/**
 * Pontuação do passe de inserção de chaves.
 *
 * Por que existe: até aqui, "o passe está bom?" era respondido por inspeção
 * humana de um lote — foi assim que 10 dos 16 modelos da Trio passaram na
 * validação e chegaram errados na revisão. Sem número, cada mudança no prompt
 * ou no planejador é uma aposta, e a decisão de construir (ou não) um revisor
 * por IA não tem como ser tomada com evidência.
 *
 * O que se mede: o PLANO (`planInsertion`), não o Doc. O plano é puro e já
 * carrega todas as travas, então a pontuação roda sem gastar escrita no Drive
 * e sem depender do Google estar de pé. O que o Docs faz com o plano é
 * conferido em outro lugar (`commitInsertion` relê o documento).
 *
 * O gabarito é por ÍNDICE DE PARÁGRAFO, não por valor: depois da padronização
 * o texto não contém mais o dado, então "o CPF do locador virou chave" só pode
 * ser afirmado por posição.
 */
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";
import { splitDocParagraphs } from "@/lib/templates/insertion-report";
import type { SemanticCategory, SemanticFinding } from "@/lib/templates/semantic-checks";
import type { InsertionPlan } from "@/lib/templates/ai-placeholder-insertion";

export interface GoldPlacement {
  token: string;
  /** Índice em {@link splitDocParagraphs} do texto do corpus. */
  paragraphIndex: number;
}

export interface GoldCase {
  /** Arquivo do corpus, relativo a `corpus/`. */
  file: string;
  modalidade: string;
  /** Onde cada chave DEVE aparecer. */
  expected: GoldPlacement[];
  /**
   * Onde uma chave NÃO pode aparecer. Serve para fixar erro já visto — a chave
   * do corretor no item da imobiliária, por exemplo — que de outro modo só
   * contaria como um `fp` anônimo entre outros.
   */
  forbidden?: GoldPlacement[];
}

export interface TokenScore {
  tp: number;
  fp: number;
  fn: number;
}

export interface CaseScore {
  file: string;
  perToken: Record<string, TokenScore>;
  tp: number;
  fp: number;
  fn: number;
  /** tp / (tp + fp) — 1 quando nada foi proposto. */
  precision: number;
  /** tp / (tp + fn) — 1 quando nada era esperado. */
  recall: number;
  /** Achados semânticos sobre o texto simulado, por categoria. */
  semantic: Record<string, number>;
  /** Motivos de descarte do planejador, por motivo. */
  skipped: Record<string, number>;
  /** Colocações proibidas que o plano produziu (subconjunto de `fp`). */
  forbiddenHits: GoldPlacement[];
}

/**
 * Blocos compostos ocupam mais de um parágrafo e o índice do gabarito aponta o
 * primeiro; uma diferença de um parágrafo é ruído de contagem, não erro de
 * colocação.
 */
const INDEX_TOLERANCE = 1;

/** Onde cada chave FICOU, lendo o texto que o plano produziria. */
export function placementsIn(text: string): GoldPlacement[] {
  const out: GoldPlacement[] = [];
  splitDocParagraphs(text).forEach((paragraph, paragraphIndex) => {
    for (const token of extractPlaceholdersFromText(paragraph)) {
      out.push({ token, paragraphIndex });
    }
  });
  return out;
}

function matches(a: GoldPlacement, b: GoldPlacement): boolean {
  return a.token === b.token && Math.abs(a.paragraphIndex - b.paragraphIndex) <= INDEX_TOLERANCE;
}

export function scoreInsertion(input: {
  gold: GoldCase;
  /** `plan.simulatedText` — o documento como ficaria se o lote entrasse. */
  simulatedText: string;
  plan: Pick<InsertionPlan, "skippedAmbiguous">;
  /** Achados de `runSemanticChecks` sobre o texto simulado (opcional). */
  semantic?: readonly SemanticFinding[];
}): CaseScore {
  const observed = placementsIn(input.simulatedText);
  const perToken: Record<string, TokenScore> = {};
  const bump = (token: string, key: keyof TokenScore) => {
    perToken[token] ??= { tp: 0, fp: 0, fn: 0 };
    perToken[token][key] += 1;
  };

  // Cada observado casa com NO MÁXIMO um esperado: sem isso, uma chave posta
  // duas vezes no lugar certo contaria dois acertos e esconderia a duplicação.
  const usadas = new Set<number>();
  for (const want of input.gold.expected) {
    const hit = observed.findIndex((o, i) => !usadas.has(i) && matches(o, want));
    if (hit === -1) {
      bump(want.token, "fn");
    } else {
      usadas.add(hit);
      bump(want.token, "tp");
    }
  }
  observed.forEach((o, i) => {
    if (!usadas.has(i)) bump(o.token, "fp");
  });

  const forbiddenHits = (input.gold.forbidden ?? []).filter((bad) =>
    observed.some((o) => matches(o, bad))
  );

  const totals = Object.values(perToken).reduce(
    (acc, t) => ({ tp: acc.tp + t.tp, fp: acc.fp + t.fp, fn: acc.fn + t.fn }),
    { tp: 0, fp: 0, fn: 0 }
  );

  const semantic: Record<string, number> = {};
  for (const f of input.semantic ?? []) {
    const key: SemanticCategory = f.category;
    semantic[key] = (semantic[key] ?? 0) + 1;
  }
  const skipped: Record<string, number> = {};
  for (const s of input.plan.skippedAmbiguous) {
    skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
  }

  return {
    file: input.gold.file,
    perToken,
    ...totals,
    precision: totals.tp + totals.fp === 0 ? 1 : totals.tp / (totals.tp + totals.fp),
    recall: totals.tp + totals.fn === 0 ? 1 : totals.tp / (totals.tp + totals.fn),
    semantic,
    skipped,
    forbiddenHits,
  };
}

/** Média ponderada pelos totais (não pela média das médias). */
export function aggregate(scores: readonly CaseScore[]): {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  forbidden: number;
} {
  const t = scores.reduce(
    (acc, s) => ({
      tp: acc.tp + s.tp,
      fp: acc.fp + s.fp,
      fn: acc.fn + s.fn,
      forbidden: acc.forbidden + s.forbiddenHits.length,
    }),
    { tp: 0, fp: 0, fn: 0, forbidden: 0 }
  );
  return {
    ...t,
    precision: t.tp + t.fp === 0 ? 1 : t.tp / (t.tp + t.fp),
    recall: t.tp + t.fn === 0 ? 1 : t.tp / (t.tp + t.fn),
  };
}
