import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { chainAdvance, requestOrigin } from "@/lib/ingestion/chain";
import { duplicateClassification } from "@/lib/ingestion/classifier";
import { authorizeIngestion, isOwnedBlobUrl } from "@/lib/ingestion/route-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
/** Teto de arquivos por lote. Acima disso o operador quebra em dois runs. */
const MAX_FILES = 200;

const fileSchema = z.object({
  filename: z.string().trim().min(1).max(300),
  blobUrl: z.string().url(),
  fileKind: z.enum(["docx", "pdf"]),
  /** SHA-256 hex do arquivo, calculado no navegador — ver o comentário abaixo. */
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(MAX_BYTES),
});

const bodySchema = z.object({
  trigger: z.enum(["central", "onboarding"]).default("central"),
  files: z.array(fileSchema).min(1).max(MAX_FILES),
});

/**
 * POST /api/templates/ingest/runs
 *
 * Intake em LOTE: a imobiliária sobe o acervo inteiro de uma vez e recebe um
 * `IngestionRun` que o servidor toca sozinho até o fim. Substitui a orquestração
 * client-side do `DocumentIngestionDialog`, que perdia o lote se a aba fechasse.
 *
 * Os arquivos JÁ estão no Vercel Blob quando esta rota é chamada (o navegador os
 * subiu direto, via o handshake em `./blob-upload`). O corpo aqui é só metadado
 * — nenhum byte trafega.
 *
 * ## Por que o `sourceHash` vem do cliente
 *
 * O dedup precisa acontecer no intake, para o item já NASCER marcado como
 * descarte sugerido. Mas hashear no servidor exigiria baixar o acervo inteiro
 * dentro de um único request — 200 arquivos de até 20MB não cabem em 60s.
 *
 * O navegador tem o arquivo em mãos e hasheia de graça (`crypto.subtle`). O
 * hash declarado só governa uma SUGESTÃO, então mentir sobre ele não ganha
 * nada: na extração o servidor recalcula o hash sobre os bytes que ele mesmo
 * leu e sobrescreve o campo, e é esse valor que `ingestTemplateFromDocx` usa
 * pro 409. O caminho de escrita nunca confia no cliente.
 */
export async function POST(req: NextRequest) {
  const authorized = await authorizeIngestion();
  if (!authorized.ok) return authorized.response;
  const { orgId, userId } = authorized.actor;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { trigger, files } = parsed.data;

  const foreign = files.find((f) => !isOwnedBlobUrl(f.blobUrl, orgId));
  if (foreign) {
    return NextResponse.json(
      { error: `Arquivo fora do espaço desta imobiliária: ${foreign.filename}` },
      { status: 403 }
    );
  }

  // Dedup do lote inteiro numa consulta só. Uma chamada por arquivo
  // (`findDuplicateTemplate`) seriam 200 idas ao banco por intake.
  const hashes = Array.from(new Set(files.map((f) => f.sourceHash)));
  const existing = await prisma.contractTemplate.findMany({
    where: { orgId, sourceHash: { in: hashes }, status: { not: "archived" } },
    select: { id: true, name: true, sourceHash: true },
    orderBy: { createdAt: "asc" },
  });
  const duplicateByHash = new Map<string, { id: string; name: string }>();
  for (const t of existing) {
    if (t.sourceHash && !duplicateByHash.has(t.sourceHash)) {
      duplicateByHash.set(t.sourceHash, { id: t.id, name: t.name });
    }
  }

  const run = await prisma.ingestionRun.create({
    data: {
      orgId,
      createdBy: userId,
      trigger,
      status: "queued",
      itemsTotal: files.length,
      itemsDone: 0,
      items: {
        create: files.map((f) => {
          const dup = duplicateByHash.get(f.sourceHash);
          return {
            filename: f.filename,
            fileKind: f.fileKind,
            blobUrl: f.blobUrl,
            sourceHash: f.sourceHash,
            // Duplicata é DESCARTE SUGERIDO, não erro: o operador pode estar
            // reingerindo de propósito (modelo revisado, template arquivado por
            // engano). O item fica visível no run, fora do caminho de execução.
            status: dup ? "discarded" : "pending",
            classification: dup
              ? (duplicateClassification({
                  reason: "duplicate_source_hash",
                  templateId: dup.id,
                  templateName: dup.name,
                }) as object)
              : undefined,
          };
        }),
      },
    },
    select: { id: true, status: true, itemsTotal: true },
  });

  // A primeira fatia sai fora do request: o operador recebe o id do run na
  // hora e acompanha por polling.
  waitUntil(chainAdvance(requestOrigin(req), run.id));

  return NextResponse.json(
    {
      runId: run.id,
      status: run.status,
      itemsTotal: run.itemsTotal,
      duplicates: files
        .filter((f) => duplicateByHash.has(f.sourceHash))
        .map((f) => f.filename),
    },
    { status: 201 }
  );
}
