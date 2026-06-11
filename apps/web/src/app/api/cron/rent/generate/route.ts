import { NextRequest, NextResponse } from "next/server";
import {
  competenciaFor,
  materializeRentChargesForCompetencia,
} from "@/lib/locacao/rent-scheduler";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/rent/generate
 *
 * Scheduler de recorrência de aluguel (docs/locacao/spec.md §6.1). Materializa
 * um RentCharge por LeaseContract ativo para a competência atual. Idempotente
 * (upsert no índice único) — re-rodar no mesmo mês não duplica.
 *
 * Schedule sugerido: mensal, dia 1 (`0 0 1 * *`) em vercel.json. Para escala
 * (muitas orgs) evoluir p/ sharding por org + fila — ver spec §13.
 *
 * NÃO emite cobrança Asaas aqui (RentCharge nasce "pendente"); a emissão é um
 * passo separado validado em sandbox/QA.
 *
 * Auth: `CRON_SECRET` via Authorization Bearer (mesmo padrão dos outros crons).
 * Query opcional `?competencia=YYYY-MM` permite reprocessar um mês específico.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/rent/generate"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/rent/generate" });
  }

  const override = req.nextUrl.searchParams.get("competencia");
  const competencia =
    override && /^\d{4}-\d{2}$/.test(override) ? override : competenciaFor(new Date());

  const result = await materializeRentChargesForCompetencia(competencia);

  return NextResponse.json(result);
}
