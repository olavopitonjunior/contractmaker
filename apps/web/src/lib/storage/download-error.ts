import { NextResponse } from "next/server";
import { StorageObjectNotFoundError } from "./s3";

/**
 * Resposta padrão para falhas de `downloadBufferFromUrl` nas rotas `/file`.
 * Objeto ausente (`StorageObjectNotFoundError` — Blob 404 / S3 NoSuchKey /
 * ENOENT) vira 404 "arquivo indisponível, reenvie"; o resto (transitório,
 * permissão) segue 500 genérico. Centralizado pra as 3 rotas de download não
 * divergirem. Ver [[project_shared_blob_refcount_delete]].
 */
export function storageDownloadErrorResponse(
  err: unknown,
  opts?: { notFoundMessage?: string; serverErrorMessage?: string }
): NextResponse {
  if (err instanceof StorageObjectNotFoundError) {
    return NextResponse.json(
      {
        error:
          opts?.notFoundMessage ??
          "Arquivo indisponível no armazenamento (pode ter sido removido). Reenvie o documento.",
      },
      { status: 404 }
    );
  }
  return NextResponse.json(
    { error: opts?.serverErrorMessage ?? "Falha ao servir arquivo" },
    { status: 500 }
  );
}
