import { TextractClient, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } from '@aws-sdk/client-textract';

const textract = new TextractClient({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? ''
      }
    : undefined
});

export async function textractPdfText(params: {
  bucket: string;
  key: string;
  maxAttempts?: number;
  pollIntervalMs?: number;
}): Promise<string> {
  const start = await textract.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: {
          Bucket: params.bucket,
          Name: params.key
        }
      }
    })
  );

  if (!start.JobId) {
    throw new Error('Textract job id missing');
  }

  const maxAttempts = params.maxAttempts ?? 20;
  const pollInterval = params.pollIntervalMs ?? 3000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await textract.send(
      new GetDocumentTextDetectionCommand({
        JobId: start.JobId
      })
    );

    if (result.JobStatus === 'SUCCEEDED') {
      const blocks = result.Blocks ?? [];
      const lines = blocks
        .filter((block) => block.BlockType === 'LINE' && block.Text)
        .map((block) => block.Text as string);
      return lines.join('\n');
    }

    if (result.JobStatus === 'FAILED') {
      throw new Error('Textract job failed');
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('Textract job timed out');
}
