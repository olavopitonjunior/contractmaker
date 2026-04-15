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

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '');
}

/**
 * Upload a buffer to shared storage.
 *
 * Priority:
 *   1. Vercel Blob (BLOB_READ_WRITE_TOKEN set) — preferred in production.
 *      Returns https://<store>.public.blob.vercel-storage.com/<key>
 *   2. AWS S3 (bucket arg + AWS_REGION set) — legacy.
 *      Returns s3://<bucket>/<key>
 *   3. Local filesystem (dev only) — throws in serverless envs.
 *      Returns file:///<path>
 */
export async function uploadBufferToStorage(params: {
  bucket?: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<string> {
  const safeKey = normalizeKey(params.key);

  // Priority 1: Vercel Blob
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const result = await put(safeKey, params.body, {
      access: 'public',
      contentType: params.contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return result.url;
  }

  // Priority 2: S3
  if (params.bucket) {
    const client = getS3Client();
    if (!client) throw new Error('AWS_REGION not configured for S3 storage');

    const { Upload } = require('@aws-sdk/lib-storage');
    const uploader = new Upload({
      client,
      params: {
        Bucket: params.bucket,
        Key: safeKey,
        Body: params.body,
        ContentType: params.contentType
      }
    });

    await uploader.done();
    return `s3://${params.bucket}/${safeKey}`;
  }

  // Priority 3: dev filesystem — NOT allowed in serverless
  if (isServerless()) {
    throw new Error(
      '[storage] Configure BLOB_READ_WRITE_TOKEN (recomendado) ou S3_BUCKET + AWS_REGION ' +
        'em produção. Fallback para filesystem não funciona em serverless (read-only /var/task).'
    );
  }

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
  const safeKey = normalizeKey(params.key);

  // Priority 1: Vercel Blob
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const result = await put(safeKey, params.body, {
      access: 'public',
      contentType: params.contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return result.url;
  }

  // Priority 2: S3
  if (params.bucket) {
    const client = getS3Client();
    if (!client) throw new Error('AWS_REGION not configured for S3 storage');

    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new PutObjectCommand({
      Bucket: params.bucket,
      Key: safeKey,
      Body: params.body,
      ContentType: params.contentType
    }));
    return `s3://${params.bucket}/${safeKey}`;
  }

  // Priority 3: dev filesystem
  if (isServerless()) {
    throw new Error(
      '[storage] Configure BLOB_READ_WRITE_TOKEN ou S3_BUCKET em produção.'
    );
  }

  const baseDir = getLocalStorageDir();
  const filePath = path.join(baseDir, safeKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, params.body, 'utf-8');
  return `file://${filePath}`;
}

/**
 * Download a buffer from a storage URL. Accepts:
 *   - https://... — fetched directly (works for Vercel Blob public URLs)
 *   - s3://<bucket>/<key>
 *   - file:///<path>
 *   - bare filesystem paths (legacy)
 */
export async function downloadBufferFromUrl(storageUrl: string): Promise<Buffer> {
  if (storageUrl.startsWith('http://') || storageUrl.startsWith('https://')) {
    const res = await fetch(storageUrl);
    if (!res.ok) {
      throw new Error(`Falha ao baixar ${storageUrl}: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

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
