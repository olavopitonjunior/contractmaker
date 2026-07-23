-- DefaultWitness.scope — módulo da testemunha padrão ("venda" | "locacao" | "proposta").
-- Idempotente (migrate deploy no build). Rows legadas viram "venda" pelo default.
ALTER TABLE "DefaultWitness" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'venda';

-- Preserva o comportamento anterior: antes do scope, mergeDefaultWitnesses
-- injetava as testemunhas padrão em TODOS os contratos (venda E locação, via
-- createEnvelopeFromBuffer). Só propostas nunca tiveram testemunhas padrão.
-- Então duplicamos cada testemunha legada (agora "venda") para o escopo
-- "locacao" — sem isso, contratos de locação sairiam SEM testemunhas após o
-- deploy. NÃO copiamos para "proposta" (comportamento novo, opt-in no cadastro).
-- Guard NOT EXISTS + escopo de origem "venda" torna a cópia idempotente.
INSERT INTO "DefaultWitness" ("id", "orgId", "nome", "cpf", "email", "mobilePhone", "isDefault", "scope", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w."orgId", w."nome", w."cpf", w."email", w."mobilePhone", w."isDefault", 'locacao', now(), now()
FROM "DefaultWitness" w
WHERE w."scope" = 'venda'
  AND NOT EXISTS (
    SELECT 1 FROM "DefaultWitness" d
    WHERE d."orgId" = w."orgId"
      AND lower(d."email") = lower(w."email")
      AND d."scope" = 'locacao'
  );

-- Índice novo por (orgId, scope); remove o antigo só-orgId se existir.
DROP INDEX IF EXISTS "DefaultWitness_orgId_idx";
CREATE INDEX IF NOT EXISTS "DefaultWitness_orgId_scope_idx" ON "DefaultWitness" ("orgId", "scope");
