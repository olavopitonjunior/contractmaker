/**
 * Validação de assinatura binária (magic bytes) — impede que alguém renomeie
 * um arquivo arbitrário com extensão/MIME falso e contorne o filtro do
 * navegador (que confia no content-type informado pelo cliente).
 */

export type SniffedType =
  | "pdf"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "zip" // docx/xlsx/pptx e zips genéricos
  | "unknown";

/** Detecta o tipo real pelos primeiros bytes. */
export function sniffFileType(buffer: Buffer): SniffedType {
  if (buffer.length < 12) return "unknown";
  // PDF: "%PDF-"
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return "png";
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "jpeg";
  // GIF: "GIF87a" / "GIF89a"
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") return "gif";
  // WEBP: "RIFF"...."WEBP"
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  // ZIP (docx etc): 50 4B 03 04
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  )
    return "zip";
  return "unknown";
}

/** Mapa MIME → tipo esperado, pra confrontar o content-type declarado. */
const MIME_TO_TYPE: Record<string, SniffedType> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "zip",
};

/**
 * Confere se os bytes reais batem com o MIME declarado. Retorna true quando
 * o MIME não tem assinatura conhecida (deixa passar tipos não cobertos em vez
 * de bloquear indevidamente) — o gate de allowlist de MIME é responsabilidade
 * do caller.
 */
export function signatureMatchesMime(buffer: Buffer, mime: string): boolean {
  const expected = MIME_TO_TYPE[mime.toLowerCase()];
  if (!expected) return true;
  return sniffFileType(buffer) === expected;
}
