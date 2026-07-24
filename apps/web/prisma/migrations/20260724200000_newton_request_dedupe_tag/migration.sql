-- NewtonRequest.dedupeTag: dedupe atômico pra criadores programáticos
-- (pesquisas de satisfação). Idempotente.
ALTER TABLE "NewtonRequest" ADD COLUMN IF NOT EXISTS "dedupeTag" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "NewtonRequest_dedupeTag_key" ON "NewtonRequest"("dedupeTag");
