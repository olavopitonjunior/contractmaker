-- Deal.sourceChannel: canal de entrada do negócio (funil por origem).
-- Nullable, sem default — deals existentes ficam NULL (não dá pra reconstruir o
-- canal com precisão retroativamente). Idempotente.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "sourceChannel" TEXT;
