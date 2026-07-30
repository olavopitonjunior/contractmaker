-- Arquivo permanente de anexos excluídos (deal e formulário).
--
-- Motivação: a exclusão de anexo de formulário era anônima e sem audit algum —
-- não havia como saber se um documento tinha sumido, nem por quem. A linha
-- aqui é escrita na MESMA transação do delete, então é a fonte da verdade do
-- rastro (audit() engole exceção por design e não serve como garantia).
--
-- Sem FK para "Deal"/"SalesForm" de propósito: Deal → DealAttachment é
-- ON DELETE CASCADE, e uma FK aqui levaria o arquivo junto ao apagar o deal,
-- destruindo justamente o registro que precisa sobreviver.
--
-- Nada expurga esta tabela: por decisão de produto o sistema não apaga nada
-- automaticamente.
--
-- Idempotente: IF NOT EXISTS em tabela e índices.

CREATE TABLE IF NOT EXISTS "DeletedAttachment" (
  "id"              TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "origin"          TEXT NOT NULL,
  "originalId"      TEXT NOT NULL,
  "dealId"          TEXT,
  "formId"          TEXT,
  "filename"        TEXT NOT NULL,
  "url"             TEXT NOT NULL,
  "category"        TEXT,
  "payload"         JSONB NOT NULL,
  "deletedByUserId" TEXT,
  "deletedVia"      TEXT NOT NULL,
  "ipAddress"       TEXT,
  "deletedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DeletedAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeletedAttachment_orgId_deletedAt_idx"
  ON "DeletedAttachment"("orgId", "deletedAt");

CREATE INDEX IF NOT EXISTS "DeletedAttachment_dealId_idx"
  ON "DeletedAttachment"("dealId");

CREATE INDEX IF NOT EXISTS "DeletedAttachment_formId_idx"
  ON "DeletedAttachment"("formId");

-- Suporta o ref-check de blob (isBlobReferenced): enquanto houver linha
-- arquivada apontando pra URL, o objeto no storage não pode ser tratado
-- como órfão.
CREATE INDEX IF NOT EXISTS "DeletedAttachment_url_idx"
  ON "DeletedAttachment"("url");

-- Marca a linha que nasceu de uma restauração. Sem FK: o arquivo é imutável e
-- não pode cascatear nada. Evita oferecer "restaurar" duas vezes pro mesmo
-- registro (o arquivo é mantido como histórico depois do restore).
ALTER TABLE "DealAttachment" ADD COLUMN IF NOT EXISTS "restoredFromId" TEXT;

CREATE INDEX IF NOT EXISTS "DealAttachment_restoredFromId_idx"
  ON "DealAttachment"("restoredFromId");
