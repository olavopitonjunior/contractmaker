-- Responsável comercial da proposta (corretor): usuário da plataforma
-- (responsibleUserId) OU nome livre de não-usuário (responsibleName).
-- Independente do criador (userId, imutável). Sem backfill: NULL cai no
-- user.name via precedência na aplicação. Idempotente (deploy roda no build).

ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "responsibleUserId" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "responsibleName" TEXT;

CREATE INDEX IF NOT EXISTS "Proposal_orgId_responsibleUserId_idx"
  ON "Proposal" ("orgId", "responsibleUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Proposal_responsibleUserId_fkey'
  ) THEN
    ALTER TABLE "Proposal"
      ADD CONSTRAINT "Proposal_responsibleUserId_fkey"
      FOREIGN KEY ("responsibleUserId") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
