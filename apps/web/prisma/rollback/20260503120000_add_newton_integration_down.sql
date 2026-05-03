-- Rollback de 20260503120000_add_newton_integration.
-- Aplicar manualmente apenas se a migration up causou problema imediato.
-- ATENÇÃO: APAGA dados de UserApiToken e IdempotencyKey.

DROP TABLE IF EXISTS "IdempotencyKey";
DROP TABLE IF EXISTS "UserApiToken";

DROP INDEX IF EXISTS "User_phone_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "phone";
