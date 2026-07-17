import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/retention
 *
 * Mensal (vercel.json `0 5 1 * *`). Retenção de tabelas de alto volume:
 *   - ContractChangeLog > 90d (watch do Drive + turns de chat — cresce sem
 *     parar; contratos aprovados ficam imutáveis, o histórico antigo não é
 *     mais consultado no painel Mudanças)
 *   - EnvelopeEvent > 90d (ledger de webhooks ClickSign; o dedupe protege
 *     contra reentrega em DIAS, não meses — apagar >90d não reabre a janela)
 *
 * AuditLog NÃO entra: imutável por design (compliance).
 *
 * Deleção em batches via subquery com LIMIT (deleteMany do Prisma não
 * limita) + guarda de tempo — a função serverless tem teto de 60s.
 */
const RETENTION_DAYS = 90;
const BATCH_SIZE = 5000;
const TIME_BUDGET_MS = 45_000;

async function purgeBatched(
  table: "ContractChangeLog" | "EnvelopeEvent",
  dateColumn: "createdAt" | "receivedAt",
  cutoff: Date,
  deadline: number
): Promise<{ deleted: number; exhausted: boolean }> {
  let deleted = 0;
  // Identificadores fixos do allowlist acima — nunca input externo.
  while (Date.now() < deadline) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE id IN (SELECT id FROM "${table}" WHERE "${dateColumn}" < $1 LIMIT ${BATCH_SIZE})`,
      cutoff
    );
    deleted += n;
    if (n < BATCH_SIZE) return { deleted, exhausted: false };
  }
  // Tempo estourou com rows sobrando — a próxima execução continua de onde parou.
  return { deleted, exhausted: true };
}

export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/retention"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/retention" });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
  const deadline = Date.now() + TIME_BUDGET_MS;

  const changeLog = await purgeBatched("ContractChangeLog", "createdAt", cutoff, deadline);
  const envelopeEvents = await purgeBatched("EnvelopeEvent", "receivedAt", cutoff, deadline);

  return NextResponse.json({
    cutoff: cutoff.toISOString(),
    contractChangeLog: changeLog,
    envelopeEvent: envelopeEvents,
  });
}
