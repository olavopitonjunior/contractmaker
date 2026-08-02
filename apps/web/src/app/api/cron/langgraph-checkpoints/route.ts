import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/langgraph-checkpoints
 *
 * Semanal. Retenção das tabelas de checkpoint do LangGraph (`checkpoints`,
 * `checkpoint_blobs`, `checkpoint_writes`), que o `PostgresSaver` cria fora do
 * Prisma e que **nunca tiveram limpeza**: uma linha por turno de chat, no mesmo
 * banco de produção, crescendo pra sempre.
 *
 * O que um checkpoint é: o estado retomável do grafo pra uma thread. NÃO é
 * histórico — a conversa vive em `ChatMessage`, e essas linhas não são tocadas
 * aqui. Apagar o checkpoint de uma sessão parada há meses só remove a
 * possibilidade de retomar o grafo do meio, que ninguém faz numa sessão morta.
 *
 * **A idade não sai da tabela.** Nenhuma das três tem coluna de tempo (o DDL do
 * `@langchain/langgraph-checkpoint-postgres` só tem `thread_id`,
 * `checkpoint_ns`, `checkpoint_id` e os blobs). A idade vem de fora, por
 * `thread_id = ChatSession.id` — que é o contrato firmado em
 * `orchestrator/checkpointer.ts`.
 *
 * O mesmo predicado pega o segundo vazamento, que é silencioso: não há FK entre
 * as tabelas do LangGraph e `ChatSession`. Apagar um contrato cascateia a sessão
 * e deixa os checkpoints **órfãos para sempre** — invisíveis por qualquer
 * consulta a partir do Prisma. `NOT EXISTS` cobre "sessão antiga" e "sessão que
 * não existe mais" de uma vez.
 */
const RETENTION_DAYS = 90;
/** Threads por lote. As três tabelas têm PK composta — não dá pra limitar por id. */
const THREAD_BATCH = 500;
const TIME_BUDGET_MS = 45_000;

const TABELAS = ["checkpoint_writes", "checkpoint_blobs", "checkpoints"] as const;

export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  const path = "/api/cron/langgraph-checkpoints";
  if (!(await isCronAllowedInStaging(path))) {
    return NextResponse.json({ skipped: "staging-disabled", path });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
  const deadline = Date.now() + TIME_BUDGET_MS;

  const deleted: Record<string, number> = {};
  let threads = 0;
  let exhausted = false;

  for (;;) {
    // Threads vivas = sessão existe E foi tocada depois do corte. Tudo o mais
    // (sessão antiga ou sessão apagada) é lixo.
    const stale = await prisma.$queryRawUnsafe<{ thread_id: string }[]>(
      `SELECT DISTINCT c.thread_id
         FROM checkpoints c
        WHERE NOT EXISTS (
                SELECT 1 FROM "ChatSession" s
                 WHERE s.id = c.thread_id AND s."updatedAt" >= $1
              )
        LIMIT ${THREAD_BATCH}`,
      cutoff
    );
    if (stale.length === 0) break;

    const ids = stale.map((r) => r.thread_id);
    threads += ids.length;

    // Placeholders explícitos ($1,$2,…) em vez de `= ANY($1::text[])`: o
    // segundo depende de como o driver serializa array JS, e este é um DELETE —
    // não é onde se descobre isso. Os ids saem do próprio banco, nunca de input
    // externo, mas continuam parametrizados.
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");

    // Filhas antes da mãe. Não há FK — a ordem é só pra não deixar blob órfão
    // caso o tempo estoure no meio do lote.
    for (const tabela of TABELAS) {
      const n = await prisma.$executeRawUnsafe(
        `DELETE FROM ${tabela} WHERE thread_id IN (${placeholders})`,
        ...ids
      );
      deleted[tabela] = (deleted[tabela] ?? 0) + n;
    }

    if (stale.length < THREAD_BATCH) break;
    if (Date.now() >= deadline) {
      // Sobrou trabalho — a próxima execução continua de onde parou.
      exhausted = true;
      break;
    }
  }

  return NextResponse.json({
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
    threads,
    deleted,
    exhausted,
  });
}
