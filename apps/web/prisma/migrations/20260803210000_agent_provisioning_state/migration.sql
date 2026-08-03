-- Estado do provisionamento de agentes externos por tenant.
--
-- Separa "nunca provisionado" de "provisionado mas o serviço não recebeu o
-- token" — a segunda deixa o flag verde no painel e o agente mudo, e sem esta
-- tabela a única pista era o corpo de uma resposta HTTP que ninguém guardava.
CREATE TABLE IF NOT EXISTS "AgentProvisioning" (
  "id"            TEXT PRIMARY KEY,
  "orgId"         TEXT NOT NULL,
  "agentKey"      TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "serviceUserId" TEXT,
  "tokenId"       TEXT,
  "deliveredAt"   TIMESTAMP(3),
  "lastError"     TEXT,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentProvisioning_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentProvisioning_orgId_agentKey_key"
  ON "AgentProvisioning" ("orgId", "agentKey");
CREATE INDEX IF NOT EXISTS "AgentProvisioning_status_idx"
  ON "AgentProvisioning" ("status");

-- Membership de usuário de serviço. A tela de membros passa a recusar a
-- remoção: o Bearer do agente resolve a org pela membership do dono do token,
-- entao remove-la derruba o agente daquele tenant em silencio.
ALTER TABLE "OrgMembership"
  ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: as memberships ja criadas para os usuarios de servico do Max.
-- O e-mail e deterministico (max+<orgId>@agents.imobpro.local), entao da pra
-- identifica-las sem depender de ordem de criacao.
UPDATE "OrgMembership" m
   SET "isSystem" = true
  FROM "User" u
 WHERE u.id = m."userId"
   AND u.email LIKE 'max+%@agents.imobpro.local'
   AND m."isSystem" = false;
