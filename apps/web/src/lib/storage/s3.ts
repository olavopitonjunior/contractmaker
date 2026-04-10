import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let s3Client: any = null;

function getS3Client() {
  if (s3Client) return s3Client;
  if (!process.env.AWS_REGION) return null;

  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? ''
        }
      : undefined
  });
  return s3Client;
}

function getLocalStorageDir(): string {
  return process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), '.storage');
}

export async function uploadBufferToStorage(params: {
  bucket?: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<string> {
  if (params.bucket) {
    const client = getS3Client();
    if (!client) throw new Error('AWS_REGION not configured for S3 storage');

    const { Upload } = require('@aws-sdk/lib-storage');
    const uploader = new Upload({
      client,
      params: {
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType
      }
    });

    await uploader.done();
    return `s3://${params.bucket}/${params.key}`;
  }

  const safeKey = params.key.replace(/^\/+/, '');
  const baseDir = getLocalStorageDir();
  const filePath = path.join(baseDir, safeKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, params.body);
  return `file://${filePath}`;
}

export async function uploadStringToStorage(params: {
  bucket?: string;
  key: string;
  body: string;
  contentType?: string;
}): Promise<string> {
  if (params.bucket) {
    const client = getS3Client();
    if (!client) throw new Error('AWS_REGION not configured for S3 storage');

    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType
    }));
    return `s3://${params.bucket}/${params.key}`;
  }

  const safeKey = params.key.replace(/^\/+/, '');
  const baseDir = getLocalStorageDir();
  const filePath = path.join(baseDir, safeKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, params.body, 'utf-8');
  return `file://${filePath}`;
}

export async function downloadBufferFromUrl(storageUrl: string): Promise<Buffer> {
  if (storageUrl.startsWith('s3://')) {
    const client = getS3Client();
    if (!client) throw new Error('AWS_REGION not configured for S3 storage');

    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const stripped = storageUrl.replace('s3://', '');
    const [bucket, ...rest] = stripped.split('/');
    const key = rest.join('/');
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) {
      throw new Error('S3 object body missing');
    }
    const chunks: Buffer[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (storageUrl.startsWith('file://')) {
    const filePath = fileURLToPath(storageUrl);
    return fs.readFileSync(filePath);
  }

  return fs.readFileSync(storageUrl);
}
