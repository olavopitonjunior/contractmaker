---
name: schema-migrations-prisma
description: Padrões de schema Prisma e migrations idempotentes no Contractmaker (Neon/Postgres, migrate deploy no build, SQL plain pra dados). Use ao adicionar models/campos, escrever migrations, ou fazer backfills.
---

# Schema Prisma + migrations (Contractmaker)

## Como migrations rodam
- Build chama `prisma generate && prisma migrate deploy && next build` (`apps/web/package.json`).
- DB é **Neon (Postgres)**. pgvector já habilitado (`vector(1024)` HNSW). `gen_random_uuid()` disponível.
- **NÃO usar `prisma migrate dev`** em prod/staging (classifier bloqueia — memória `feedback_auto_mode_blocks_migrate_dev`). Mudanças de DDL via schema + migration; mudanças de DADOS (rename/backfill) via **SQL plain idempotente** com timestamp incremental.

## Padrão idempotente (copiar de `20260603120000_*` / CronToggle)
```sql
CREATE TABLE IF NOT EXISTS "Nome" ( ... CONSTRAINT "Nome_pkey" PRIMARY KEY ("id") );
DO $$ BEGIN
  CREATE UNIQUE INDEX "Nome_a_b_key" ON "Nome"("a","b");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Nome_x_idx" ON "Nome"("x");
DO $$ BEGIN
  ALTER TABLE "Nome" ADD CONSTRAINT "Nome_fk" FOREIGN KEY ("orgId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```
Backfill re-rodável: `INSERT ... SELECT ... ON CONFLICT (...) DO NOTHING;` (usar `CROSS JOIN (VALUES ...)` para popular N linhas/org).

## Gotchas
- **Json/array default drift** (`feedback_prisma_array_default_drift`): `String[]`/Json NOT NULL sem `@default` sofre DROP DEFAULT no `migrate deploy`; inserts sem a coluna quebram (23502). Para entitlements, prefira `@default("{}")` e resolva defaults reais no código.
- **`prisma generate --no-engine`** antes do `tsc` quando `next dev` está rodando (EPERM no rename do engine — memória `feedback_prisma_generate_no_engine`).
- **`prisma format` pode reverter edições** do schema entre Edit e commit — sempre `git diff` antes de commitar (memória `feedback_prisma_format_reverts_schema`).
- `cuid()` em models novos; `uuid()` só em legados.
- Validar após editar schema: `pnpm prisma:validate`.

## Verificação de migration
`prisma migrate deploy` em staging → conferir linhas criadas → **re-rodar** a migration (idempotência: zero erro, zero duplicata).
