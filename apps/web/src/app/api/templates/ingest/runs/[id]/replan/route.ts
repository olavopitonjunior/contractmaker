import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { chainAdvance, requestOrigin } from "@/lib/ingestion/chain";
import { authorizeIngestion } from "@/lib/ingestion/route-auth";
import {
  INGESTION_NOTES_FLAG,
  MAX_NOTES,
  MAX_NOTE_CHARS,
} from "@/lib/ingestion/library-snapshot";

export const runtime = "nodejs";

/** Comentários deste replanejamento: poucos e curtos — é instrução, não anexo. */
const MAX_COMMENTS = 10;
const MAX_COMMENT_CHARS = 500;

const bodySchema = z
  .object({
    /** Instruções só para ESTA reanálise (entram no prompt do planner). */
    comments: z.array(z.string().max(MAX_COMMENT_CHARS)).max(MAX_COMMENTS).optional(),
    /** Instruções que valem para TODO lote futuro do tenant (WS1.4). */
    notes: z.array(z.string().max(MAX_NOTE_CHARS)).max(MAX_NOTES).optional(),
  })
  .strict();

/**
 * POST /api/templates/ingest/runs/:id/replan
 *
 * Reprocessa SÓ o planejamento: extração e classificação já estão pagas e
 * gravadas, então a rota devolve o run para `planning` com escadas zeradas e a
 * corrente refaz a proposta — opcionalmente guiada pelos comentários do
 * operador. É o mesmo movimento que antes exigia UPDATE manual no banco, e o
 * que transforma um run `failed` em recuperável em vez de "envie tudo de novo".
 *
 * Só sessão (owner/admin): reprocessar custa uma chamada de planner por
 * família (~US$ 0,40–0,60 cada) e é decisão do operador, nunca da corrente.
 *
 * Recusa quando a execução já começou: cláusulas e templates já escritos não
 * são desfeitos por um plano novo — nesse ponto o caminho é um lote novo.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authorized = await authorizeIngestion();
  if (!authorized.ok) return authorized.response;
  const { orgId, userId } = authorized.actor;

  const parsed = bodySchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const comments = (parsed.data.comments ?? []).map((c) => c.trim()).filter(Boolean);
  const notes = (parsed.data.notes ?? []).map((n) => n.trim()).filter(Boolean);

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
          "Este lote já começou a ser aplicado — cláusulas e modelos criados não " +
          "são desfeitos por uma proposta nova. Para reprocessar, envie um lote novo.",
      },
      { status: 409 }
    );
  }
  if (!["awaiting_review", "failed"].includes(run.status)) {
    return NextResponse.json(
      {
        error: `O lote está em "${run.status}" e não pode ser reprocessado agora.`,
        status: run.status,
      },
      { status: 409 }
    );
  }

  // Notas persistentes ANTES do replan: o digest da chamada que vem aí já as lê.
  if (notes.length > 0) {
    await appendIngestionNotes(orgId, userId, notes);
  }

  // Escadas zeradas (replanejar É pagar de novo, por decisão do operador) e os
  // comentários no report — é de lá que o executor os injeta no prompt.
  const { planning: _drop, ...rest } = report;
  const nextReport = {
    ...rest,
    ...(comments.length > 0 ? { planningComments: comments } : {}),
  };
  const updated = await prisma.ingestionRun.updateMany({
    where: { id: run.id, orgId, status: { in: ["awaiting_review", "failed"] } },
    data: {
      status: "planning",
      startedAt: null,
      error: null,
      report: nextReport as object,
    },
  });
  if (updated.count === 0) {
    return NextResponse.json(
      { error: "O lote mudou de estado — recarregue a página." },
      { status: 409 }
    );
  }

  waitUntil(chainAdvance(requestOrigin(req), run.id));

  return NextResponse.json({
    runId: run.id,
    status: "planning",
    comments: comments.length,
    notesSaved: notes.length,
  });
}

/** Anexa notas persistentes ao módulo de locação, com cap e FIFO. */
async function appendIngestionNotes(
  orgId: string,
  userId: string,
  notes: readonly string[]
): Promise<void> {
  const module_ = await prisma.orgModule.findFirst({
    where: { orgId, module: "locacao" },
    select: { id: true, featureFlags: true },
  });
  if (!module_) return;
  const flags = (module_.featureFlags ?? {}) as Record<string, unknown>;
  const current = Array.isArray(flags[INGESTION_NOTES_FLAG])
    ? (flags[INGESTION_NOTES_FLAG] as unknown[])
    : [];
  const at = new Date().toISOString();
  const appended = [
    ...current,
    ...notes.map((text) => ({ text, author: userId, at })),
  ].slice(-MAX_NOTES);
  await prisma.orgModule.update({
    where: { id: module_.id },
    data: { featureFlags: { ...flags, [INGESTION_NOTES_FLAG]: appended } as object },
  });
}
