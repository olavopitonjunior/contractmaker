-- Restaura DEFAULT da coluna CertidaoJob.missingFields.
--
-- A migration original (20260418130000_add_certidao_job_retry_fields) criou a
-- coluna com `DEFAULT ARRAY[]::TEXT[]` mas o schema.prisma ficou sem
-- `@default([])`. Em algum migrate deploy posterior, Prisma detectou o drift
-- e emitiu `ALTER COLUMN DROP DEFAULT`, deixando a coluna NOT NULL sem
-- default. Resultado: prisma.certidaoJob.create() — que omite a coluna
-- quando não é passada — passou a quebrar com 23502 (null violates not-null).
--
-- Sintoma observado em prod 2026-05-11: POST /api/deals/:id/certidoes
-- retornava 500 PrismaClientKnownRequestError; nenhum CertidaoJob nascia.
--
-- Esta migration restaura o DEFAULT no Postgres. O schema.prisma também
-- ganha `@default([])` para que o drift não volte no próximo migrate deploy.

ALTER TABLE "CertidaoJob"
  ALTER COLUMN "missingFields" SET DEFAULT ARRAY[]::TEXT[];
