import fs from 'fs';

export interface PdfExtraction {
  text: string;
  numPages?: number;
}

export async function extractPdf(filePath: string): Promise<PdfExtraction> {
  const buffer = fs.readFileSync(filePath);
  const pdfParseModule = await import('pdf-parse');
  const pdfParse = pdfParseModule.default ?? pdfParseModule;
  const data = await pdfParse(buffer);
  return {
    text: data.text ?? '',
    numPages: data.numpages
  };
}
