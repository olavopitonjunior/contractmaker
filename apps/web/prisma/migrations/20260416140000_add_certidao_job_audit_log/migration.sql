-- Phase F.II-β — audit log de transições de status em CertidaoJob.
-- Cada update relevante (pending → fetching → success/failed/awaiting_portal)
-- registra uma row aqui para debug e observabilidade.

CREATE TABLE "CertidaoJobAuditLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertidaoJobAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CertidaoJobAuditLog_jobId_createdAt_idx"
ON "CertidaoJobAuditLog"("jobId", "createdAt");

ALTER TABLE "CertidaoJobAuditLog"
ADD CONSTRAINT "CertidaoJobAuditLog_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "CertidaoJob"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
