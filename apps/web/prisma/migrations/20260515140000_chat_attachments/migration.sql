-- ChatAttachment: PDF/DOCX uploads e URLs anexados ao chat.
-- O extractedText alimenta o contexto do agente quando o turn
-- referencia o attachment via attachmentIds no body de /chat.

CREATE TABLE IF NOT EXISTS "ChatAttachment" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "blobUrl" TEXT,
  "sourceUrl" TEXT,
  "extractedText" TEXT,
  "byteSize" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatAttachment_sessionId_idx"
  ON "ChatAttachment"("sessionId");

-- FK só adiciona se não existir (Postgres não tem ADD CONSTRAINT IF NOT EXISTS
-- antes de v14, usar DO block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatAttachment_sessionId_fkey'
  ) THEN
    ALTER TABLE "ChatAttachment"
      ADD CONSTRAINT "ChatAttachment_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
