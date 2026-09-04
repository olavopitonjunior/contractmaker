import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authorizeIngestion } from "@/lib/ingestion/route-auth";
import {
  isTerminalRunStatus,
  RUN_STALE_MS,
  TERMINAL_RUN_STATUSES,
  type RunStatus,
} from "@/lib/ingestion/run-state";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * POST /api/templates/ingest/runs/[id]/cancel — "Descartar lote".
 *
 * Um lote que travou, ou que a conferência mostrou não valer a pena, ficava
 * para sempre como "lote aberto" no banner de /templates — não havia como
 * encerrá-lo sem executar. `cancelled` já existia na máquina de estados
 * (`run-state.ts`) e nunca era escrito por ninguém.
 *
 * A disponibilidade vai no WHERE do `updateMany`, como no claim do executor:
 * status não-terminal E sem invocação viva (`startedAt` nulo ou passado do
 * stale). Cancelar por cima de um worker em voo seria sobrescrito por ele no
 * próximo estágio — então quem está em processamento recebe 409 e tenta
 * depois. Os itens ainda não executados viram `discarded`; o que já virou
 * modelo fica (o modelo é um rascunho independente do lote). Blobs e texto
 * ficam também: o "refazer padronização" reencontra o arquivo por
 * `sourceHash` e não olha o status do lote, de propósito.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = await authorizeIngestion();
  if (!authz.ok) return authz.response;
  const { orgId, userId } = authz.actor;

  const run = await prisma.ingestionRun.findFirst({
    where: { id: params.id, orgId },
    select: { id: true, status: true },
  });
  if (!run) return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
  if (isTerminalRunStatus(run.status as RunStatus)) {
    return NextResponse.json(
      { error: "Este lote já terminou — não há o que descartar.", code: "RUN_TERMINAL", status: run.status },
      { status: 409 }
    );
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - RUN_STALE_MS);
  const updated = await prisma.ingestionRun.updateMany({
    where: {
      id: run.id,
      orgId,
      status: { notIn: [...TERMINAL_RUN_STATUSES] },
      OR: [{ startedAt: null }, { startedAt: { lt: staleBefore } }],
    },
    data: { status: "cancelled", error: null, startedAt: null },
  });
  if (updated.count === 0) {
    return NextResponse.json(
      {
        error: "O lote está sendo processado neste momento. Aguarde alguns segundos e tente de novo.",
        code: "RUN_BUSY",
      },
      { status: 409 }
    );
  }

  const items = await prisma.ingestionItem.updateMany({
    where: { runId: run.id, status: { notIn: ["executed", "discarded"] } },
    data: { status: "discarded" },
  });

  await audit(extractAuditContextFromRequest(req, orgId, userId), {
    action: "INGESTION_RUN_CANCELLED",
    result: "SUCCESS",
    resource: run.id,
    resourceType: "IngestionRun",
    metadata: { previousStatus: run.status, itemsDiscarded: items.count },
  });

  return NextResponse.json({ ok: true, status: "cancelled", itemsDiscarded: items.count });
}
