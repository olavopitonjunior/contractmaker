/**
 * Estado civil que exige outorga do cônjuge.
 *
 * Fonte única. A regra vivia como `Set(["Casado(a)", "União Estável"])` copiada
 * em `validation.ts`, `validation-locacao.ts`, `party-required.ts`,
 * `dedup-conjuges.ts` e nos templates Handlebars — e nenhuma cópia batia com o
 * que o OCR devolve: os prompts do Gemini pedem `"União estável"` (minúsculo)
 * em `ccv-extractor.ts` e `locacao-extractor.ts`. Um deal importado por OCR não
 * disparava a exigência do cônjuge, nem a recomendação de e-mail, nem o dedup —
 * e as camadas discordavam entre si sobre quem é casado, a ponto de o cônjuge
 * assinar um contrato em que não aparecia qualificado.
 *
 * Os templates consomem via helper `temConjuge` (lib/render/handlebars.ts).
 *
 * A normalização (lowercase + sem acento + sem sufixo de gênero) resolve as
 * variantes conhecidas: "Casado(a)", "casado", "Casada", "União Estável",
 * "União estável", "Uniao Estavel".
 */

/** Rótulos canônicos usados nos selects do formulário. */
export const ESTADOS_CIVIS_COM_CONJUGE = ["Casado(a)", "União Estável"] as const;

function normalize(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // "casado(a)" / "casada" / "companheiro(a)" → radical comparável
    .replace(/\(a\)/g, "")
    .replace(/\s+/g, " ");
}

/**
 * True quando o estado civil implica outorga conjugal (casamento ou união
 * estável). Estrito de propósito: é o predicado que EXIGE dados do cônjuge
 * (bloqueia o finalize) e que dispara a recomendação de e-mail — só cobra de
 * quem declarou casamento.
 */
export function isMarried(estadoCivil: unknown): boolean {
  const s = normalize(estadoCivil);
  if (!s) return false;
  return s.startsWith("casad") || s.startsWith("uniao estavel");
}

const SEM_CONJUGE = ["solteir", "divorciad", "viuv", "separad", "desquitad"];

/**
 * True só quando o estado civil declara EXPLICITAMENTE que não há cônjuge.
 * Ausente ou desconhecido devolve `false`.
 *
 * É o predicado complementar de `isMarried`, e a assimetria é intencional:
 * para EXCLUIR alguém da assinatura ou da qualificação, exigir prova de
 * casamento seria arriscado demais — um dataJson legado ou vindo do OCR sem
 * `estado_civil` derrubaria a outorga de um casal de verdade e invalidaria o
 * contrato. Aqui só sai quem declarou não ter cônjuge.
 */
export function isExplicitlyUnmarried(estadoCivil: unknown): boolean {
  const s = normalize(estadoCivil);
  if (!s) return false;
  return SEM_CONJUGE.some((prefix) => s.startsWith(prefix));
}
