-- LGPD: soft-delete de User com janela de reversal de 30 dias.
-- `deletedAt` marca a hora da solicitação. `deletionScheduledAt` aponta
-- para 30 dias depois — cron de hard-delete (futuro) varre essa janela.
-- Logins ficam bloqueados quando deletedAt IS NOT NULL.

ALTER TABLE "User"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionScheduledAt" TIMESTAMP(3);

CREATE INDEX "User_deletionScheduledAt_idx"
  ON "User"("deletionScheduledAt")
  WHERE "deletionScheduledAt" IS NOT NULL;
