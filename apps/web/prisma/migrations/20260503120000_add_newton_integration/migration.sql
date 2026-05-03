-- Newton — integração com agente externo via WhatsApp.
--
-- Adiciona:
--  - User.phone (E.164, único, opcional) — mapeamento WhatsApp → user
--  - UserApiToken — Bearer tokens com escopos
--  - IdempotencyKey — replay-safety para POST/PATCH/DELETE externos
--
-- Rollback: ver `prisma/rollback/20260503120000_add_newton_integration_down.sql`.

-- 1. User.phone
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- 2. UserApiToken
CREATE TABLE "UserApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserApiToken_hashedToken_key" ON "UserApiToken"("hashedToken");
CREATE INDEX "UserApiToken_userId_revokedAt_idx" ON "UserApiToken"("userId", "revokedAt");

ALTER TABLE "UserApiToken" ADD CONSTRAINT "UserApiToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. IdempotencyKey
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseHash" TEXT NOT NULL,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
