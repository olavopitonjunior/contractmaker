-- Multitenant Fase 1f — drill-down + impersonatedBy no AuditLog + índices. Idempotente.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "impersonatedBy" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_orgId_resourceType_createdAt_idx" ON "AuditLog"("orgId", "resourceType", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_orgId_impersonatedBy_createdAt_idx" ON "AuditLog"("orgId", "impersonatedBy", "createdAt");
