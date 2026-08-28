import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { advanceReviewRun } from "@/lib/contract-review/executor";
import { auth, getUserOrg } from "@/lib/auth/auth";

export const runtime = "nodejs";
// A revisão faz UMA chamada de LLM (PR 3) mais leitura do Doc — cabe com folga,
// mas o teto alto protege a escada de retry do revisor.
export const maxDuration = 300;

/**
 * POST /api/contracts/review-runs/:runId/advance
 *
 * Processa o run de revisão pós-geração INTEIRO (um contrato = uma unidade).
 * Idempotente: o claim vive no `where` do updateMany; a segunda invocação
 * concorrente recebe `claimed: false` e desiste. Comentários são upsert por
 * dedupeKey — re-executar não duplica.
 *
 * Duas portas, como o /advance da ingestão:
 * - **CRON_SECRET** (enqueue da geração + sweeper) — tentada primeiro, não
 *   toca no banco.
 * - **Sessão** de membro da org do run — para depuração/disparo manual; run de
 *   outra org é 404 idêntico a inexistente.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const internal = requireCronAuth(req) === null;

  if (!internal) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const org = await getUserOrg(session.user.id);
    if (!org) {
      return NextResponse.json({ error: "No organization" }, { status: 400 });
    }
    // Run de outra org = 404 idêntico a inexistente.
    const run = await prisma.contractReviewRun.findFirst({
      where: { id: params.runId, orgId: org.id },
      select: { id: true },
    });
    if (!run) {
      return NextResponse.json({ error: "Revisão não encontrada" }, { status: 404 });
    }
  }

  const result = await advanceReviewRun(params.runId);
  if (result.status === "not-found") {
    return NextResponse.json({ error: "Revisão não encontrada" }, { status: 404 });
  }
  return NextResponse.json(result);
}
