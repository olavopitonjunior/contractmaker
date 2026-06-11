-- Multitenant Fase 0c — AuditLog.orgId nullable.
-- Eventos pré-resolução de tenant (webhook ClickSign antes de achar o envelope)
-- gravam orgId=NULL em vez de cair no SHARED_ORG_ID. Idempotente.
ALTER TABLE "AuditLog" ALTER COLUMN "orgId" DROP NOT NULL;
