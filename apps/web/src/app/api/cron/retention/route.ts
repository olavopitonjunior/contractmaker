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
 * Mensal (vercel.json `0 5 1 * *`). Retenção de RUÍDO do ContractChangeLog:
 * apaga apenas rows > 90d com `action` em NOISE_ACTIONS —
 *   - "google_doc_updated": ping do watch do Drive (1 row por edição no doc,
 *     sem conteúdo — só resourceState/channelId). É o motor de crescimento
 *     da tabela (~350 rows/contrato em prod).
 *   - "validation": marcador de análise passiva (contagem de findings).
 *
 * O que NÃO entra, de propósito:
 *   - Rows de edição (chat/humano, com htmlBefore/htmlAfter): são o painel
 *     Mudanças — negociação longa (4+ meses é comum em imóvel) precisa do
 *     histórico inteiro, e produto jurídico não apaga trilha de edição.
 *   - EnvelopeEvent: o `dedupeKey @unique` é o LOCK de idempotência do
 *     webhook ClickSign (webhook-process.ts) — apagar reabriria a janela de
 *     replay pra envelopes antigos, e o volume é trivial (~10 rows/envelope).
 *   - AuditLog: imutável por design (compliance).
 *
 * Deleção em batches via subquery com LIMIT (deleteMany do Prisma não
 * limita) + guarda de tempo — teto serverless de 60s. Índice de suporte:
 * ContractChangeLog(action, createdAt).
 */
const RETENTION_DAYS = 90;
const BATCH_SIZE = 5000;
const TIME_BUDGET_MS = 45_000;
const NOISE_ACTIONS = ["google_doc_updated", "validation"] as const;

export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/retention"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/retention" });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
  const deadline = Date.now() + TIME_BUDGET_MS;

  let deleted = 0;
  let exhausted = false;
  for (;;) {
    // Identificadores e actions são constantes do módulo — nunca input externo.
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "ContractChangeLog" WHERE id IN (
         SELECT id FROM "ContractChangeLog"
         WHERE "action" IN ('${NOISE_ACTIONS.join("','")}') AND "createdAt" < $1
         LIMIT ${BATCH_SIZE}
       )`,
      cutoff
    );
    deleted += n;
    if (n < BATCH_SIZE) break;
    if (Date.now() >= deadline) {
      // Tempo estourou com rows sobrando — a próxima execução continua.
      exhausted = true;
      break;
    }
  }

  return NextResponse.json({
    cutoff: cutoff.toISOString(),
    contractChangeLog: { deleted, exhausted, actions: NOISE_ACTIONS },
  });
}
