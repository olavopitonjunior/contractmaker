import fs from 'fs';
import mammoth from 'mammoth';

export interface DocxExtraction {
  html: string;
  text: string;
}

export async function extractDocx(filePath: string): Promise<DocxExtraction> {
  const buffer = fs.readFileSync(filePath);
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const textResult = await mammoth.extractRawText({ buffer });
  return {
    html: htmlResult.value ?? '',
    text: textResult.value ?? ''
  };
}
