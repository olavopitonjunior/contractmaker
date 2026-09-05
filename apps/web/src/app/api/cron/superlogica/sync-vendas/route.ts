import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { syncSuperlogicaVendas } from "@/lib/superlogica/export/sync-vendas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Cada venda é 1 GET + possíveis lançamentos; o teto por execução é o freio. */
export const maxDuration = 300;

const PATH = "/api/cron/superlogica/sync-vendas";

/**
 * GET /api/cron/superlogica/sync-vendas
 *
 * Fecha o ciclo da exportação: a Superlógica cobra a comissão, então é de lá
 * que vem a notícia de que o dinheiro entrou. Parcela liquidada leva o negócio
 * para "Comissão paga" e lança a despesa de cada comissionado; venda cancelada
 * ou excluída do outro lado marca a exportação com erro, sem mexer no funil.
 *
 * Idempotente: o lançamento de despesa é guardado por SuperlogicaLink, então
 * uma execução repetida não paga o comissionado duas vezes.
 *
 * Schedule: a cada 30 minutos (vercel.json). Auth: `CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!(await isCronAllowedInStaging(PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: PATH });
  }
  const report = await syncSuperlogicaVendas();
  return NextResponse.json(report);
}
