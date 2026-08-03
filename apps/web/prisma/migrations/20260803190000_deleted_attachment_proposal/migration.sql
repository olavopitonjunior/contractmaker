-- DeletedAttachment ganha `proposalId`: o arquivo de exclusões passa a cobrir
-- ProposalAttachment (origin = "proposal"), que até agora não tinha rota de
-- exclusão nenhuma — dava pra anexar e não dava pra remover.
--
-- Plain SQL e idempotente: `prisma migrate deploy` roda no build, e uma
-- reexecução (redeploy, branch recriada) não pode falhar.
ALTER TABLE "DeletedAttachment" ADD COLUMN IF NOT EXISTS "proposalId" TEXT;

CREATE INDEX IF NOT EXISTS "DeletedAttachment_proposalId_idx"
  ON "DeletedAttachment"("proposalId");
