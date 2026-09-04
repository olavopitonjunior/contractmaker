-- Log de envio aos corretores PARCEIROS de uma proposta (e-mail nos marcos
-- "encaminhada", "assinada pelo proponente" e "completa").
--
-- POR QUÊ. Até aqui os marcos de proposta só tocavam o sino do dono
-- (`notifyProposalMilestone` → Notification). O parceiro que acompanha o
-- negócio — corretor de outra imobiliária ou da casa — não tinha canal nenhum.
-- O e-mail precisa de dedupe próprio: `completed` dispara de cinco call-sites
-- (webhook, sync, cron, conclusão manual, reconciliação) e o `Notification`
-- deduplica por dono, não por destinatário externo.
--
-- Chave: (proposta, marco, canal, destinatário). Sem `dedupeKey` por evento —
-- o marco de proposta acontece uma vez (status machine CAS). Insert-first:
-- P2002 = já enviado.
--
-- Aditiva e idempotente (CREATE IF NOT EXISTS + FK com guard).

CREATE TABLE IF NOT EXISTS "ProposalNotificationLog" (
  "id"             TEXT NOT NULL,
  "orgId"          TEXT NOT NULL,
  "proposalId"     TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "channel"        TEXT NOT NULL,
  "recipientKey"   TEXT NOT NULL,
  "recipientLabel" TEXT,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "detail"         JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProposalNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProposalNotificationLog_dedupe_key"
  ON "ProposalNotificationLog"("proposalId", "kind", "channel", "recipientKey");

CREATE INDEX IF NOT EXISTS "ProposalNotificationLog_orgId_proposalId_createdAt_idx"
  ON "ProposalNotificationLog"("orgId", "proposalId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProposalNotificationLog_orgId_fkey'
  ) THEN
    ALTER TABLE "ProposalNotificationLog"
      ADD CONSTRAINT "ProposalNotificationLog_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProposalNotificationLog_proposalId_fkey'
  ) THEN
    ALTER TABLE "ProposalNotificationLog"
      ADD CONSTRAINT "ProposalNotificationLog_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
