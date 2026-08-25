-- Pipeline de ingestão em lote (Fase A1).
--
-- ── Por que a orquestração virou tabela ──────────────────────────────────
--
-- A Central de ingestão orquestrava tudo no browser: o `DocumentIngestionDialog`
-- guardava a fila, o texto extraído e as decisões em memória e chamava
-- `ingest/analyze` uma vez por arquivo. Um acervo de imobiliária tem dezenas de
-- documentos e a extração de um PDF escaneado passa de 30s — fechar a aba no
-- meio perdia o lote inteiro, sem retomada.
--
-- `IngestionRun` é o ponto de retomada. Cada invocação de
-- `POST /runs/:id/advance` processa uma FATIA de itens (o maxDuration da Vercel
-- é 120s) e se re-encadeia; o cron `/api/cron/ingestion/advance` varre o que
-- ficou parado. O estado vive no banco, então nenhuma etapa depende de a aba
-- continuar aberta.
--
-- ── O claim ──────────────────────────────────────────────────────────────
--
-- `startedAt` é o claim, no MESMO padrão de `FormAttachment.extractingStartedAt`
-- (lib/ai/ocr-worker.ts): a condição de disponibilidade (`startedAt IS NULL` OU
-- mais velho que a janela de stale) faz parte do `where` do `updateMany`, e o
-- Postgres resolve a corrida — duas invocações simultâneas, uma delas recebe
-- `count = 0` e desiste. Não há tabela de lock: um worker que morre libera o run
-- pelo simples passar do tempo.
--
-- ── Índices ──────────────────────────────────────────────────────────────
--
-- `(orgId, status)` — a Central lista os runs da org por estado.
-- `(status, updatedAt)` — o sweeper procura runs travados sem varrer por org.

CREATE TABLE "IngestionRun" (
    "id"           TEXT NOT NULL,
    "orgId"        TEXT NOT NULL,
    "createdBy"    TEXT,
    "trigger"      TEXT NOT NULL DEFAULT 'central',
    "status"       TEXT NOT NULL DEFAULT 'queued',
    "itemsTotal"   INTEGER NOT NULL DEFAULT 0,
    "itemsDone"    INTEGER NOT NULL DEFAULT 0,
    "libraryPlan"  JSONB,
    "planReviewed" JSONB,
    "report"       JSONB,
    "aiCostUsd"    DECIMAL(12,6),
    "error"        TEXT,
    "startedAt"    TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IngestionItem" (
    "id"             TEXT NOT NULL,
    "runId"          TEXT NOT NULL,
    "filename"       TEXT NOT NULL,
    "fileKind"       TEXT NOT NULL,
    "blobUrl"        TEXT NOT NULL,
    "sourceHash"     TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending',
    "text"           TEXT,
    "classification" JSONB,
    "piiReport"      JSONB,
    "error"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngestionRun_orgId_status_idx" ON "IngestionRun"("orgId", "status");

CREATE INDEX "IngestionRun_status_updatedAt_idx" ON "IngestionRun"("status", "updatedAt");

CREATE INDEX "IngestionItem_runId_status_idx" ON "IngestionItem"("runId", "status");

ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
