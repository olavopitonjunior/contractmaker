import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authorizeIngestion } from "@/lib/ingestion/route-auth";

export const runtime = "nodejs";

/**
 * GET /api/templates/ingest/runs/:id
 *
 * Estado do run para o polling da Central: o estágio, o progresso e a situação
 * de cada arquivo. Não devolve `text` — são até 200k chars por item, e a tela
 * não mostra o texto extraído.
 *
 * Run inexistente e run de OUTRA imobiliária devolvem o MESMO 404. Distinguir
 * os dois confirmaria a existência de um run alheio a quem sabe adivinhar um id.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const authorized = await authorizeIngestion();
  if (!authorized.ok) return authorized.response;

  const run = await prisma.ingestionRun.findFirst({
    where: { id: params.id, orgId: authorized.actor.orgId },
    select: {
      id: true,
      trigger: true,
      status: true,
      itemsTotal: true,
      itemsDone: true,
      libraryPlan: true,
      planReviewed: true,
      report: true,
      error: true,
      aiCostUsd: true,
      createdAt: true,
      updatedAt: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          filename: true,
          fileKind: true,
          status: true,
          sourceHash: true,
          blobUrl: true,
          classification: true,
          piiReport: true,
          error: true,
        },
      },
    },
  });
  if (!run) {
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  }

  return NextResponse.json(run);
}
