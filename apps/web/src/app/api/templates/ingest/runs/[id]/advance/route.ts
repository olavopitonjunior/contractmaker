import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { chainAdvance, requestOrigin } from "@/lib/ingestion/chain";
import { advanceRun } from "@/lib/ingestion/run-executor";
import { authorizeIngestion } from "@/lib/ingestion/route-auth";

export const runtime = "nodejs";
// O executor para em 90s (INGESTION_SLICE_BUDGET_MS) justamente pra sobrar
// tempo de gravar o estado e disparar a próxima fatia dentro deste teto.
export const maxDuration = 120;

/**
 * POST /api/templates/ingest/runs/:id/advance
 *
 * Avança o run uma FATIA e se re-encadeia. Cada invocação reivindica o run,
 * processa alguns itens do estágio corrente (extração ~5 por vez, que é o
 * gargalo de OCR), libera o claim e, se sobrou trabalho, dispara a próxima em
 * `waitUntil` — a resposta já foi enviada.
 *
 * Idempotente: o claim do run e o claim de cada item vivem no `where` do
 * update, então chamar duas vezes em paralelo não reprocessa nada. É por isso
 * que a UI pode chamar sem medo e o cron pode varrer ao mesmo tempo.
 *
 * ## Duas portas de entrada
 *
 * - **Sessão** (owner/admin da org): a Central chamando. O `orgId` entra em
 *   toda query — run de outra imobiliária é 404, igual a inexistente.
 * - **`CRON_SECRET`**: a corrente e o sweeper. Sem sessão, sem `orgId` — o id
 *   do run já veio de uma listagem do próprio servidor. A porta interna é
 *   tentada PRIMEIRO porque ela não toca no banco.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const internal = requireCronAuth(req) === null;

  let orgId: string | undefined;
  if (!internal) {
    const authorized = await authorizeIngestion();
    if (!authorized.ok) return authorized.response;
    orgId = authorized.actor.orgId;
  }

  const result = await advanceRun({ runId: params.id, orgId });

  if (!result.claimed) {
    // Ou o run não existe / é de outra imobiliária (404 idêntico nos dois
    // casos), ou está com outra invocação, ou já chegou num estágio que não
    // avança sozinho (`awaiting_review` e `executing` esperam gente).
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
    waitUntil(chainAdvance(requestOrigin(req), params.id));
  }

  return NextResponse.json(result);
}
