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
 * Retorna a "cauda" de overlap de `s` começando numa FRONTEIRA DE PALAVRA — o
 * overlap não inicia no meio de uma palavra (fragmento polui o embedding do
 * próximo chunk). A cauda-alvo tem ~overlapChars; AVANÇA de `rawStart` até o
 * PRÓXIMO espaço, então a cauda retornada é sempre ≤ overlapChars e começa em
 * palavra íntegra. Só quando NÃO há espaço de rawStart até o fim (token único
 * gigante, ex.: base64/URL) cai no corte cru em rawStart. Como a cauda nunca
 * excede overlapChars (e o chamador garante overlapChars ≤ maxChars/2), o loop
 * de hard-cut sempre progride — sem risco de explosão nem de loop infinito.
 */
function wordSafeTail(s: string, overlapChars: number): string {
  if (overlapChars <= 0 || s.length <= overlapChars) return s;
  const rawStart = s.length - overlapChars;
  const nextSpace = s.indexOf(" ", rawStart);
  if (nextSpace === -1) return s.slice(rawStart);
  return s.slice(nextSpace + 1);
}

export function chunkText(
  text: string,
  maxTokens: number = DEFAULT_MAX_TOKENS,
  overlapTokens: number = DEFAULT_OVERLAP_TOKENS
): Chunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  // Clampa o overlap a ≤ metade do chunk. Garante que a cauda de overlap
  // (≤ overlapChars) seja sempre menor que o corte do hard-cut loop → progresso
  // garantido (sem loop infinito quando o chamador pede overlap ≥ maxChars).
  const overlapChars = Math.min(
    overlapTokens * CHARS_PER_TOKEN,
    Math.floor(maxChars / 2)
  );

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
