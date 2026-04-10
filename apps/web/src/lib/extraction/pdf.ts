export async function extractPdf(buffer: Buffer): Promise<{ text: string; numPages?: number }> {
  const pdfParseModule = await import('pdf-parse');
  const pdfParse = pdfParseModule.default ?? pdfParseModule;
  const data = await pdfParse(buffer);
  return {
    text: data.text ?? '',
    numPages: data.numpages
  };
}
