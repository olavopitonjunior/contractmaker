-- EnvelopeDocument — N documentos por envelope ClickSign.
--
-- A ClickSign v3 aceita vários documentos no MESMO envelope e cobra por
-- SIGNATÁRIO, não por documento. Enviar contrato de locação + laudo de vistoria
-- juntos passa a custar 1x por signatário (antes: 2 envelopes = 2 cobranças).
--
-- Aditiva e 100% idempotente (migrate deploy roda no build):
--  * NENHUM CHECK existente é tocado. `envelope_subject_xor` continua exigindo
--    exatamente um sujeito (contractId|attachmentId|proposalId) — os documentos
--    kind="attachment" são carga extra do envelope, não um segundo sujeito.
--  * `Envelope.documentClicksignId` PERMANECE. Passa a ser o doc `primary`;
--    envelopes anteriores a esta tabela não têm rows aqui e seguem sendo lidos
--    pela coluna escalar (fallback no código).
--  * Sem backfill: só envelopes criados daqui pra frente ganham rows.

CREATE TABLE IF NOT EXISTS "EnvelopeDocument" (
  "id"                  TEXT NOT NULL,
  "envelopeId"          TEXT NOT NULL,
  "documentClicksignId" TEXT NOT NULL,
  "kind"                TEXT NOT NULL DEFAULT 'primary',
  "sourceAttachmentId"  TEXT,
  "filename"            TEXT NOT NULL,
  "signedPdfUrl"        TEXT,
  "position"            INTEGER NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnvelopeDocument_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  CREATE UNIQUE INDEX "EnvelopeDocument_envelopeId_documentClicksignId_key"
    ON "EnvelopeDocument"("envelopeId", "documentClicksignId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "EnvelopeDocument_envelopeId_idx"
  ON "EnvelopeDocument"("envelopeId");

-- Lookup do webhook: um evento do documento EXTRA traz o `document.key` dele,
-- que não bate com `Envelope.documentClicksignId`.
CREATE INDEX IF NOT EXISTS "EnvelopeDocument_documentClicksignId_idx"
  ON "EnvelopeDocument"("documentClicksignId");

DO $$ BEGIN
  ALTER TABLE "EnvelopeDocument" ADD CONSTRAINT "EnvelopeDocument_envelopeId_fkey"
    FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
