-- Campos aditivos para o painel super-admin (métricas + ações). Idempotente.
-- Auto-mode bloqueia `prisma migrate dev` em prod; SQL plano com IF NOT EXISTS.

-- Suspensão administrativa de tenant (painel super-admin).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);

-- Tamanho de arquivo (bytes) para métricas de storage por tenant. Forward-only:
-- anexos antigos ficam null; o upload passa a preencher daqui pra frente.
ALTER TABLE "DealAttachment" ADD COLUMN IF NOT EXISTS "byteSize" INTEGER;
ALTER TABLE "FormAttachment" ADD COLUMN IF NOT EXISTS "byteSize" INTEGER;
