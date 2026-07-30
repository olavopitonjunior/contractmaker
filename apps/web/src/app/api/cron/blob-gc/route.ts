import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { listStorage, deleteFromStorage } from "@/lib/storage/s3";
import { isBlobReferenced } from "@/lib/contracts/delete-cleanup";
import { runOrphanBlobGc } from "@/lib/storage/orphan-gc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/blob-gc
 *
 * Semanal (vercel.json `0 4 * * 0`). Apaga blobs ÓRFÃOS (nenhuma row do banco
 * referencia) e mais velhos que a carência, sob os prefixos de anexo puro. Fecha
 * o resíduo TOCTOU do PR #150. Ver lib/storage/orphan-gc.ts pras invariantes de
 * segurança (escopo por prefixo, ref-check abrangente, carência, stores por env).
 *
 * ⛔ RELATÓRIO APENAS — NUNCA APAGA. Decisão de produto (2026-07-30): o sistema
 * não exclui nada automaticamente. A env `BLOB_GC_DELETE` deixou de ser lida e
 * o cron saiu do vercel.json; o que sobra é um endpoint manual de diagnóstico,
 * pra responder "quanto lixo de storage existe" sem tocar em nada.
 *
 * Contexto de quem for reativar: um documento excluído hoje tem o blob
 * PRESERVADO de propósito (`DeletedAttachment` guarda a linha e a URL entra em
 * BLOB_REF_CHECKS), porque é isso que torna a restauração possível. Um GC que
 * apague por "órfão" reintroduz exatamente a perda que este trabalho fechou.
 * Se um dia houver custo de storage que justifique, a conversa é sobre expurgo
 * explícito e auditado — não sobre religar esta flag.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/blob-gc"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/blob-gc" });
  }

  // Travado em false. Não é configurável: ver o bloco de doc acima.
  const apply = false;
  // Só o ambiente staging varre as variantes `staging/<prefix>`. Em prod, varrer
  // `staging/` apagaria blobs de staging se o token do Blob fosse compartilhado
  // (defesa cross-env — ver orphan-gc.ts). Rotação semanal do prefixo inicial
  // pra fairness sem estado.
  const includeStagingLayout = process.env.STAGING_MODE === "true";
  const startOffset = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));

  const result = await runOrphanBlobGc(
    {
      listStorage,
      isReferenced: (url) => isBlobReferenced(prisma, url),
      deleteBlob: (url) => deleteFromStorage(url),
      now: () => Date.now(),
    },
    { apply, includeStagingLayout, startOffset }
  );

  if (result.orphans > 0) {
    console.log(
      `[blob-gc] apply=${apply} scanned=${result.scanned} orphans=${result.orphans} ` +
        `deleted=${result.deleted} exhausted=${result.exhausted}`,
      result.byPrefix
    );
  }

  return NextResponse.json(result);
}
