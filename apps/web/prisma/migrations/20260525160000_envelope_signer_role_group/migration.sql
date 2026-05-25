-- Qualificação ("Assina como") e ordem de assinatura por signatário.
-- role: papel ClickSign (buyer/seller/witness/party/...); signingGroup: grupo
-- de ordem (v3). Ambos nullable, sem default; idempotente.
ALTER TABLE "EnvelopeSigner" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "EnvelopeSigner" ADD COLUMN IF NOT EXISTS "signingGroup" INTEGER;
