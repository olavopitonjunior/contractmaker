-- Resumo consolidado do formulário por e-mail.
-- OrgFormSettings ganha config de destinatário + automação; SalesForm ganha
-- marco de último envio (protege a automação contra re-disparo em re-finalize).
-- Aditiva e idempotente.
ALTER TABLE "OrgFormSettings" ADD COLUMN IF NOT EXISTS "summaryRecipientEmail" TEXT;
ALTER TABLE "OrgFormSettings" ADD COLUMN IF NOT EXISTS "autoSendSummaryOnComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrgFormSettings" ADD COLUMN IF NOT EXISTS "summaryIncludeAttachments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SalesForm" ADD COLUMN IF NOT EXISTS "summarySentAt" TIMESTAMP(3);
