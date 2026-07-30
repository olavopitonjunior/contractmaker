-- Envelope.attachmentId: SET NULL -> CASCADE
--
-- O CHECK `envelope_subject_xor` exige num_nonnulls(contractId, attachmentId,
-- proposalId) = 1. Com ON DELETE SET NULL, apagar um DealAttachment que já teve
-- envelope de assinatura (source="attachment") tentava anular o attachmentId e
-- violava a constraint (SQLSTATE 23514) — o DELETE do anexo e o DELETE do deal
-- inteiro estouravam 500 e o anexo virava indelével.
--
-- O envelope de anexo não existe sem o anexo, então a cascata é a semântica
-- correta. A rota DELETE do anexo bloqueia com 409 quando há envelope
-- closed/running, então na prática a cascata só alcança draft/canceled/failed.
--
-- Idempotente: DROP IF EXISTS + ADD.

ALTER TABLE "Envelope" DROP CONSTRAINT IF EXISTS "Envelope_attachmentId_fkey";

ALTER TABLE "Envelope"
  ADD CONSTRAINT "Envelope_attachmentId_fkey"
  FOREIGN KEY ("attachmentId") REFERENCES "DealAttachment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
