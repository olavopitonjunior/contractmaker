/**
 * Detecção do tipo real do arquivo pelo MAGIC BYTE.
 *
 * Extraído de `api/knowledge/upload/route.ts` quando a ingestão de plataforma
 * apareceu: duas rotas checando cabeçalho binário por conta própria é como uma
 * delas acaba confiando no `Content-Type` declarado — que o cliente controla.
 */

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Teto declarado. O corpo de request da Vercel para bem antes disso (~4.5MB) —
 * subir este número é fix falso; o caminho certo é upload client-direct, que
 * está fora deste lote. Mantido igual nas duas rotas pra não divergirem.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function sniffDocument(buffer: Buffer): "pdf" | "docx" | null {
  if (buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.")) return "pdf";
  // DOCX é um zip → magic PK\x03\x04
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "docx";
  }
  return null;
}
