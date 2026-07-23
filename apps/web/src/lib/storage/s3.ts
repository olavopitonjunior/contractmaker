import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Objeto ausente no storage (Blob 404 / S3 NoSuchKey / filesystem ENOENT). As
 * rotas `/file` distinguem isto de um erro transitório (401/403/408/timeout):
 * um objeto removido vira 404 "reenvie o documento"; o resto segue 500. Antes o
 * mapeamento era por regex `/HTTP 40\d/` na mensagem — só pegava o branch Blob e
 * confundia 403/408 com "removido".
 */
export class StorageObjectNotFoundError extends Error {
  constructor(public readonly storageUrl: string) {
    super(`Objeto não encontrado no storage: ${storageUrl}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

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
  const cleaned = key.replace(/^\/+/, '');
  // Em staging, prefixa "staging/" pra isolar do bucket prod quando token compartilhado.
  if (process.env.STAGING_MODE === "true" && !cleaned.startsWith("staging/")) {
    return `staging/${cleaned}`;
  }
  return cleaned;
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
    // addRandomSuffix: true — sufixo aleatório na key torna a URL não
    // adivinhável. Antes era false + key determinística (ex.:
    // envelopes/<contractId>/signed.pdf), então PDFs assinados, certidões
    // (CPF) e KYC ficavam em URLs enumeráveis. Defesa em profundidade: o
    // caller sempre persiste a URL retornada, então nada depende da key
    // determinística. Documentos sensíveis devem ser servidos pela rota
    // proxy autenticada /api/files/* (ver fase 2 do plano de segurança).
    const result = await put(safeKey, params.body, {
      access: 'public',
      contentType: params.contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
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
    // addRandomSuffix: true — sufixo aleatório na key torna a URL não
    // adivinhável. Antes era false + key determinística (ex.:
    // envelopes/<contractId>/signed.pdf), então PDFs assinados, certidões
    // (CPF) e KYC ficavam em URLs enumeráveis. Defesa em profundidade: o
    // caller sempre persiste a URL retornada, então nada depende da key
    // determinística. Documentos sensíveis devem ser servidos pela rota
    // proxy autenticada /api/files/* (ver fase 2 do plano de segurança).
    const result = await put(safeKey, params.body, {
      access: 'public',
      contentType: params.contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
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
    // 404 = objeto removido → erro tipado (vira 404 amigável na rota). Outros
    // status (401/403/408/5xx) são transitórios/permissão → erro genérico (500).
    if (res.status === 404) {
      throw new StorageObjectNotFoundError(storageUrl);
    }
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
    let response;
    try {
      response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err: any) {
      // S3 sinaliza objeto ausente por name (NoSuchKey/NotFound) ou 404.
      if (
        err?.name === 'NoSuchKey' ||
        err?.name === 'NotFound' ||
        err?.$metadata?.httpStatusCode === 404
      ) {
        throw new StorageObjectNotFoundError(storageUrl);
      }
      throw err;
    }
    if (!response.Body) {
      // Body ausente com GetObject BEM-SUCEDIDO (sem NoSuchKey/404) é uma
      // condição transitória/anômala do SDK, NÃO um objeto removido — o objeto
      // existe (a chamada não lançou). Erro genérico → 500 retryável, não o 404
      // "reenvie o documento" (que induziria re-upload duplicado de algo intacto).
      throw new Error(`S3 GetObject retornou sem Body para ${storageUrl}`);
    }
    const chunks: Buffer[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  try {
    const filePath = storageUrl.startsWith('file://')
      ? fileURLToPath(storageUrl)
      : storageUrl;
    return fs.readFileSync(filePath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new StorageObjectNotFoundError(storageUrl);
    }
    throw err;
  }
}

/**
 * Apaga um objeto de storage, despachando por backend (Vercel Blob / S3 /
 * filesystem). Antes só limpava Vercel Blob nos call-sites — URLs `s3://` e
 * `file://` ficavam órfãs. Best-effort por design: erros são engolidos e o
 * caller decide se loga (deleção de arquivo nunca deve derrubar a operação
 * principal). Retorna true se tentou apagar, false se ignorou (URL externa
 * que não controlamos / vazia).
 */
export async function deleteFromStorage(storageUrl: string | null | undefined): Promise<boolean> {
  if (!storageUrl) return false;
  try {
    // Vercel Blob: URL pública https no domínio do store.
    if (storageUrl.includes('.blob.vercel-storage.com')) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
      const { del } = await import('@vercel/blob');
      await del(storageUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
      return true;
    }

    if (storageUrl.startsWith('s3://')) {
      const client = getS3Client();
      if (!client) return false;
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const stripped = storageUrl.replace('s3://', '');
      const [bucket, ...rest] = stripped.split('/');
      const key = rest.join('/');
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    }

    if (storageUrl.startsWith('file://')) {
      const filePath = fileURLToPath(storageUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }

    // https externa não-Blob (não controlamos) ou path bare legado.
    if (storageUrl.startsWith('http://') || storageUrl.startsWith('https://')) {
      return false;
    }
    if (fs.existsSync(storageUrl)) {
      fs.unlinkSync(storageUrl);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[storage] deleteFromStorage falhou:', storageUrl, err);
    return false;
  }
}

export interface StorageListItem {
  url: string;
  pathname: string;
  uploadedAt: Date;
}
export interface StorageListPage {
  items: StorageListItem[];
  cursor: string | null;
  hasMore: boolean;
}

/**
 * Lista objetos do storage sob um prefixo (paginado). Usado pelo cron de GC de
 * blobs órfãos. Só implementado pro Vercel Blob (backend de produção); S3/local
 * retornam vazio — o GC só opera com Blob (guarda no próprio cron).
 *
 * `prefix` filtra por pathname; `cursor`/`hasMore` paginam. As URLs retornadas
 * são as canônicas (com sufixo aleatório) — o GC casa por URL EXATA contra o
 * banco, nunca reconstrói keys.
 */
export async function listStorage(params: {
  prefix?: string;
  cursor?: string;
  limit?: number;
}): Promise<StorageListPage> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { list } = await import('@vercel/blob');
    const res = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      prefix: params.prefix,
      cursor: params.cursor,
      limit: params.limit ?? 1000,
    });
    return {
      items: res.blobs.map((b) => ({
        url: b.url,
        pathname: b.pathname,
        uploadedAt: b.uploadedAt instanceof Date ? b.uploadedAt : new Date(b.uploadedAt),
      })),
      cursor: res.cursor ?? null,
      hasMore: res.hasMore,
    };
  }
  return { items: [], cursor: null, hasMore: false };
}
