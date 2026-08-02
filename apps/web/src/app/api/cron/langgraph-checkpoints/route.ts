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

// Nomes sem schema qualificado: o setup (`setup-langgraph-tables.ts` /
// `PostgresSaver.fromConnString`) nunca passa schema custom, então as tabelas
// vivem em `public` e resolvem pelo search_path default. Se o checkpointer um
// dia ganhar schema próprio, isto precisa acompanhar.
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

  try {
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

      // Por que SELECT primeiro e só depois DELETE, em vez do subquery embutido
      // que o `/api/cron/retention` usa: aqui são TRÊS deletes que precisam mirar
      // exatamente o mesmo conjunto. Um subquery repetido em cada statement leria
      // `checkpoints` de novo — e depois que a terceira apagasse a mãe, as duas
      // primeiras já teriam visto conjuntos possivelmente diferentes (o LIMIT sem
      // ORDER BY não promete a mesma página duas vezes). Fixar os ids uma vez é o
      // que garante que blob e write apagados pertencem ao checkpoint apagado.

      // Placeholders explícitos ($1,$2,…) em vez de `= ANY($1::text[])`: o
      // segundo depende de como o driver serializa array JS, e este é um DELETE —
      // não é onde se descobre isso. Os ids saem do próprio banco, nunca de input
      // externo, mas continuam parametrizados.
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");

      // Os TRÊS deletes numa transação (review #227): falha no meio do trio
      // deixava estado parcialmente apagado até a próxima execução — inócuo
      // (o NOT EXISTS re-seleciona), mas evitável. É o mesmo all-or-nothing
      // que o `deleteThread` da própria lib faz, em lote.
      const counts = await prisma.$transaction(
        TABELAS.map((tabela) =>
          prisma.$executeRawUnsafe(
            `DELETE FROM ${tabela} WHERE thread_id IN (${placeholders})`,
            ...ids
          )
        )
      );
      TABELAS.forEach((tabela, i) => {
        deleted[tabela] = (deleted[tabela] ?? 0) + counts[i];
      });

      if (stale.length < THREAD_BATCH) break;
      if (Date.now() >= deadline) {
        // Sobrou trabalho — a próxima execução continua de onde parou.
        exhausted = true;
        break;
      }
    }
  } catch (err) {
    // Sem isto o erro viraria 500 genérico e os contadores do que JÁ foi
    // apagado se perderiam da resposta (review #227). O trabalho restante é
    // retomado na próxima execução — o predicado re-seleciona.
    console.error("[langgraph-checkpoints] lote falhou:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        cutoff: cutoff.toISOString(),
        threads,
        deleted,
        partial: true,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
    threads,
    deleted,
    exhausted,
  });
}
