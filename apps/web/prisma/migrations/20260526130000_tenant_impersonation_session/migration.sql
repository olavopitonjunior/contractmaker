-- Multitenant Fase 1e — sessão de impersonação de tenant pelo super-admin.
-- Campos planos (sem FK); consultada por adminUserId/orgId + janela ativa. Idempotente.
CREATE TABLE IF NOT EXISTS "TenantImpersonationSession" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "TenantImpersonationSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TenantImpersonationSession_adminUserId_endedAt_idx" ON "TenantImpersonationSession"("adminUserId", "endedAt");
CREATE INDEX IF NOT EXISTS "TenantImpersonationSession_orgId_startedAt_idx" ON "TenantImpersonationSession"("orgId", "startedAt");
