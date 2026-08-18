-- Inspection.laudoOrigem: distingue laudo gerado internamente de PDF externo
-- enviado por upload. Aditiva e idempotente.
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "laudoOrigem" TEXT NOT NULL DEFAULT 'gerado';
