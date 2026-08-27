import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { stripNulDeep } from "@/lib/ingestion/pg-text";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { chainExecute, requestOrigin } from "@/lib/ingestion/chain";
import { executePlanSlice } from "@/lib/ingestion/plan-executor";
import { authorizeIngestion } from "@/lib/ingestion/route-auth";
import type { ReviewedLibraryPlan } from "@/lib/ingestion/library-plan";

export const runtime = "nodejs";
// Cada fatia sobe UM template (Drive + pass de IA). O executor para em 240s pra
// sobrar tempo de gravar o relatório e re-encadear — cópia de Doc mais um pass
// de IA por template não cabia com folga nos 120s de antes.
export const maxDuration = 300;

const MAX_ENTRIES = 500;

/**
 * O corpo é a DECISÃO da revisão, não o plano.
 *
 * `reviewedBy`/`reviewedAt` são carimbados pelo servidor: quem aprovou é uma
 * afirmação sobre uma pessoa e não pode vir do cliente que está sendo
 * autenticado. E o plano em si não trafega — ele já está em `libraryPlan`, e
 * aceitar um plano no corpo deixaria o operador aprovar um conteúdo que a tela
 * nunca mostrou.
 */
const bodySchema = z.object({
  templates: z
    .array(z.object({ sourceItemId: z.string().min(1).max(64), approved: z.boolean() }))
    .max(MAX_ENTRIES)
    .default([]),
  clauses: z
    .array(
      z.object({
        sourceItemId: z.string().min(1).max(64),
        tags: z.array(z.string().max(120)).max(20).default([]),
        approved: z.boolean(),
      })
    )
    .max(MAX_ENTRIES)
    .default([]),
  discards: z
    .array(z.object({ itemId: z.string().min(1).max(64), approved: z.boolean() }))
    .max(MAX_ENTRIES)
    .default([]),
});

/**
 * POST /api/templates/ingest/runs/:id/execute
 *
 * Aplica o plano APROVADO — cláusulas no acervo, modelos no Drive — e fecha o
 * run com o relatório.
 *
 * ## Duas portas, como no `/advance`
 *
 * - **Sessão** (owner/admin): a tela de revisão. Com corpo, é a APROVAÇÃO —
 *   grava `planReviewed` e leva o run de `awaiting_review` a `executing`. Sem
 *   corpo, é "continue de onde parou" (o operador reabriu a tela de um run que
 *   travou no meio).
 * - **`CRON_SECRET`**: a corrente entre fatias. Sempre sem corpo.
 *
 * A transição `awaiting_review → executing` vai no `where` do `updateMany`: é o
 * UPDATE do Postgres que decide quem aprovou primeiro. Dois cliques no botão
 * (ou duas abas) não geram duas execuções — o segundo encontra o run já em
 * `executing` e vira continuação.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const internal = requireCronAuth(req) === null;

  let orgId: string | undefined;
  let userId: string | undefined;
  if (!internal) {
    const authorized = await authorizeIngestion();
    if (!authorized.ok) return authorized.response;
    orgId = authorized.actor.orgId;
    userId = authorized.actor.userId;
  }

  // Corpo ausente/vazio é continuação, não erro: é assim que a corrente e o
  // "continuar" da tela chegam aqui.
  const raw = internal ? null : await req.json().catch(() => null);
  if (raw !== null && raw !== undefined) {
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Revisão inválida", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const reviewed: ReviewedLibraryPlan = {
      reviewedBy: userId!,
      reviewedAt: new Date().toISOString(),
      templates: parsed.data.templates,
      clauses: parsed.data.clauses,
      discards: parsed.data.discards,
    };

    const started = await prisma.ingestionRun.updateMany({
      where: { id: params.id, ...(orgId ? { orgId } : {}), status: "awaiting_review" },
      data: {
        planReviewed: stripNulDeep(reviewed) as unknown as object,
        status: "executing",
        error: null,
        startedAt: null,
      },
    });

    if (started.count === 0) {
      const run = await prisma.ingestionRun.findFirst({
        where: { id: params.id, ...(orgId ? { orgId } : {}) },
        select: { status: true },
      });
      // Inexistente e de outra imobiliária dão o MESMO 404 — distinguir os dois
      // confirmaria a existência de um run alheio a quem adivinhar um id.
      if (!run) {
        return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
      }
      if (run.status !== "executing") {
        return NextResponse.json(
          {
            error:
              run.status === "done"
                ? "Este lote já foi aplicado."
                : `O lote está em "${run.status}" e não pode ser aplicado agora.`,
            code: "RUN_NOT_REVIEWABLE",
            status: run.status,
          },
          { status: 409 }
        );
      }
      // Já está executando: a segunda aprovação não sobrescreve a primeira —
      // segue como continuação da fatia.
    }
  }

  const result = await executePlanSlice({ runId: params.id, orgId });

  if (!result.claimed) {
    const run = await prisma.ingestionRun.findFirst({
      where: { id: params.id, ...(orgId ? { orgId } : {}) },
      select: { status: true, itemsTotal: true, itemsDone: true },
    });
    if (!run) {
      return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ...result, ...run });
  }

  if (result.hasMore) {
    waitUntil(chainExecute(requestOrigin(req), params.id));
  }

  return NextResponse.json(result);
}
