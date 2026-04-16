import { PDFDocument } from "pdf-lib";

/**
 * Extract only the first N pages of a PDF buffer. Used to reduce token
 * consumption when sending multi-page PDFs (procurações, escrituras) to
 * Gemini — most critical data is on the first 1-2 pages.
 *
 * Returns the original buffer untouched if:
 *   - The PDF has fewer pages than `maxPages`
 *   - pdf-lib fails to parse it (corrupt PDF — let Gemini handle it)
 *   - Any other error during the trim
 *
 * Never throws.
 */
export async function extractFirstPages(
  buffer: Buffer,
  maxPages = 2
): Promise<{ buffer: Buffer; pagesKept: number; totalPages: number; trimmed: boolean }> {
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = src.getPageCount();
    if (total <= maxPages) {
      return { buffer, pagesKept: total, totalPages: total, trimmed: false };
    }

    const dest = await PDFDocument.create();
    const indices = Array.from({ length: maxPages }, (_, i) => i);
    const copied = await dest.copyPages(src, indices);
    for (const page of copied) dest.addPage(page);
    const trimmedBytes = await dest.save();
    return {
      buffer: Buffer.from(trimmedBytes),
      pagesKept: maxPages,
      totalPages: total,
      trimmed: true,
    };
  } catch (err) {
    console.warn(
      `[pdf-utils] failed to trim PDF (${err instanceof Error ? err.message : "?"}), using original`
    );
    return { buffer, pagesKept: 0, totalPages: 0, trimmed: false };
  }
}

/**
 * Quick check for `%PDF-` header to decide if a buffer looks like a valid PDF.
 * Used by prevalidateForOcr as an extra sanity check.
 */
export function isPdfBuffer(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}
