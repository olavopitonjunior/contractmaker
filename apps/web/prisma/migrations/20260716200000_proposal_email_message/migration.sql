-- Mensagem/assunto customizável da notificação de assinatura das propostas.
-- Null = template padrão da ClickSign. Idempotente.
ALTER TABLE "OrgSignatureSettings" ADD COLUMN IF NOT EXISTS "proposalEmailSubject" TEXT;
ALTER TABLE "OrgSignatureSettings" ADD COLUMN IF NOT EXISTS "proposalEmailMessage" TEXT;
