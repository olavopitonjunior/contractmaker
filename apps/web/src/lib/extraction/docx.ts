import mammoth from 'mammoth';

export async function extractDocx(buffer: Buffer): Promise<{ html: string; text: string }> {
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const textResult = await mammoth.extractRawText({ buffer });
  return {
    html: htmlResult.value ?? '',
    text: textResult.value ?? ''
  };
}
