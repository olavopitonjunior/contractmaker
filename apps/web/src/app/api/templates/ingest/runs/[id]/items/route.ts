import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { chainAdvance, requestOrigin } from "@/lib/ingestion/chain";
import { authorizeIngestion, isOwnedBlobUrl } from "@/lib/ingestion/route-auth";
import { duplicateClassification } from "@/lib/ingestion/classifier";

export const runtime = "nodejs";

const fileSchema = z.object({
  filename: z.string().min(1).max(255),
  fileKind: z.enum(["docx", "pdf"]),
  blobUrl: z.string().url(),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
});

const bodySchema = z
  .object({
    files: z.array(fileSchema).min(1).max(20),
    /** Item deste run que os arquivos novos substituem (vira descarte). */
    replaceItemId: z.string().min(1).optional(),
  })
  .strict();

/**
 * POST /api/templates/ingest/runs/:id/items
 *
 * Anexa (ou substitui) arquivos num run que está NA REVISÃO — o "reanexar por
 * template" da tela. O caso de uso: o planner escolheu um contrato preenchido
 * como base porque era o único da garantia, e o operador tem a minuta em branco
 * em mãos. Antes, a saída era jogar o run fora e subir tudo de novo; agora só
 * os arquivos novos passam por extração e classificação (o resto já está pago)
 * e o planejamento refaz com o lote completo.
 *
 * Os bytes já estão no Blob (mesmo handshake do intake, `../blob-upload`);
 * aqui só entra metadado. Depois de anexar, o run volta para `extracting` e o
 * plano anterior deixa de valer — reanexar É pedir replanejamento.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authorized = await authorizeIngestion();
  if (!authorized.ok) return authorized.response;
  const { orgId } = authorized.actor;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { files, replaceItemId } = parsed.data;

  const foreign = files.find((f) => !isOwnedBlobUrl(f.blobUrl, orgId));
  if (foreign) {
    return NextResponse.json(
      { error: `Arquivo fora do espaço desta imobiliária: ${foreign.filename}` },
      { status: 403 }
    );
  }

  const run = await prisma.ingestionRun.findFirst({
    where: { id: params.id, orgId },
    select: { id: true, status: true, report: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }
  const report = (run.report ?? {}) as Record<string, unknown>;
  if (report.execution) {
    return NextResponse.json(
      {
        error:
          "Este lote já começou a ser aplicado — anexe os arquivos num lote novo.",
      },
      { status: 409 }
    );
  }
  if (!["awaiting_review", "failed"].includes(run.status)) {
    return NextResponse.json(
      {
        error: `O lote está em "${run.status}" e não aceita anexos agora.`,
        status: run.status,
      },
      { status: 409 }
    );
  }

  if (replaceItemId) {
    const target = await prisma.ingestionItem.findFirst({
      where: { id: replaceItemId, runId: run.id },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: "O arquivo a substituir não está neste lote." },
        { status: 404 }
      );
    }
  }

  // Mesmo dedup do intake: arquivo que já é template nasce descarte sugerido.
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

  // Grouping e planning saem do report: os dois foram computados sobre um lote
  // que deixou de existir. O plano anterior fica em `libraryPlan` só até o novo
  // sobrescrever — a tela mostra o progresso enquanto isso.
  const { planning: _p, grouping: _g, planningComments: _c, ...rest } = report;

  await prisma.$transaction(async (tx) => {
    if (replaceItemId) {
      await tx.ingestionItem.update({
        where: { id: replaceItemId },
        data: {
          status: "discarded",
          classification: {
            via: "operator",
            reason: `Substituído na revisão por: ${files
              .map((f) => f.filename)
              .join(", ")}.`,
          } as object,
        },
      });
    }
    await tx.ingestionItem.createMany({
      data: files.map((f) => {
        const dup = duplicateByHash.get(f.sourceHash);
        return {
          runId: run.id,
          filename: f.filename,
          fileKind: f.fileKind,
          blobUrl: f.blobUrl,
          sourceHash: f.sourceHash,
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
    });
    const total = await tx.ingestionItem.count({ where: { runId: run.id } });
    const updated = await tx.ingestionRun.updateMany({
      where: { id: run.id, orgId, status: { in: ["awaiting_review", "failed"] } },
      data: {
        status: "extracting",
        startedAt: null,
        error: null,
        itemsTotal: total,
        report: rest as object,
      },
    });
    if (updated.count === 0) {
      throw new Error("O lote mudou de estado — recarregue a página.");
    }
  });

  waitUntil(chainAdvance(requestOrigin(req), run.id));

  return NextResponse.json({
    runId: run.id,
    status: "extracting",
    added: files.length,
    replaced: replaceItemId ?? null,
    duplicates: files
      .filter((f) => duplicateByHash.has(f.sourceHash))
      .map((f) => f.filename),
  });
}
