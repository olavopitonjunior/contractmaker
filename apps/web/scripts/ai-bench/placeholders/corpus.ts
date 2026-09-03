import path from "path";

/**
 * O corpus são os contratos REAIS já anonimizados que a ingestão usa nos
 * testes de consolidação (`__tests__/fixtures/ativa-residencial`). Reusar em
 * vez de copiar é deliberado: um segundo corpus divergiria do primeiro sem
 * ninguém perceber, e o teto de risco de PII é o de arquivo já revisado.
 */
export const CORPUS_DIR = path.join(
  __dirname,
  "../../../src/lib/templates/__tests__/fixtures/ativa-residencial"
);

export const GOLD_DIR = path.join(__dirname, "gold");
