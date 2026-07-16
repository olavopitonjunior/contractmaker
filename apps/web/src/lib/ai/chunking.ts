/**
 * Text chunking for knowledge base indexing.
 *
 * Splits long documents into overlapping chunks that each fit comfortably in
 * Voyage's 2048-token context window. Uses a paragraph-first strategy: merge
 * paragraphs until hitting the target size, then emit a chunk with small
 * overlap to preserve semantic continuity across boundaries.
 */

export interface Chunk {
  text: string;
  index: number;
  total: number;
}

// Rough char-to-token ratio for PT-BR text (1 token ≈ 4 chars)
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 100;

/**
 * Retorna a "cauda" de overlap de `s` com ~overlapChars, mas começando numa
 * FRONTEIRA DE PALAVRA — evita o overlap iniciar no meio de uma palavra (que
 * polui o embedding do próximo chunk com um fragmento sem sentido). Avança o
 * ponto de corte até o próximo espaço; se a palavra for longa demais (>25%
 * além do overlap), mantém o corte cru pra não perder contexto.
 */
function wordSafeTail(s: string, overlapChars: number): string {
  if (overlapChars <= 0 || s.length <= overlapChars) return s;
  const rawStart = s.length - overlapChars;
  // Recua até a fronteira de palavra no espaço em/antes de rawStart — overlap
  // fica ligeiramente maior que o alvo, porém começa em palavra íntegra.
  // LIMITE do backtrack a ~2× overlapChars: sem isso, um bloco com um espaço
  // isolado no começo seguido de um token gigante faria o tail ≈ a string
  // inteira, e o loop de hard-cut avançaria ~1 char/iteração (explosão de
  // chunks). Recuo além do limite → corte cru em rawStart (aceitável no caso
  // patológico de token único enorme).
  const minStart = rawStart - overlapChars;
  const prevSpace = s.lastIndexOf(" ", rawStart);
  if (prevSpace >= minStart) return s.slice(prevSpace + 1);
  return s.slice(rawStart);
}

export function chunkText(
  text: string,
  maxTokens: number = DEFAULT_MAX_TOKENS,
  overlapTokens: number = DEFAULT_OVERLAP_TOKENS
): Chunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  // Short input — emit as single chunk
  if (cleaned.length <= maxChars) {
    return [{ text: cleaned, index: 0, total: 1 }];
  }

  // Split by double newline (paragraphs); fall back to single newline, then sentences
  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim());
  const rawBlocks = paragraphs.length > 1 ? paragraphs : cleaned.split(/\n+/).filter((p) => p.trim());
  const blocks =
    rawBlocks.length > 1 ? rawBlocks : cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];

  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // If adding this block would exceed maxChars, flush current and start new
    if (current && current.length + trimmed.length + 2 > maxChars) {
      chunks.push(current.trim());
      // Keep tail of current as overlap (na fronteira de palavra)
      const tail = wordSafeTail(current, overlapChars);
      current = tail + "\n\n" + trimmed;
    } else {
      current = current ? current + "\n\n" + trimmed : trimmed;
    }

    // If a single block is already huge, we need to break it forcibly
    while (current.length > maxChars) {
      const hardCut = current.slice(0, maxChars);
      const lastSpace = hardCut.lastIndexOf(" ");
      const cutAt = lastSpace > maxChars * 0.7 ? lastSpace : maxChars;
      chunks.push(current.slice(0, cutAt).trim());
      current = wordSafeTail(current.slice(0, cutAt), overlapChars) + current.slice(cutAt);
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks.map((text, i) => ({ text, index: i, total: chunks.length }));
}

/**
 * Estimate token count for budgeting.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
