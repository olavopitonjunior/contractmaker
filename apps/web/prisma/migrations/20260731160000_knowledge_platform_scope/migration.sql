-- RAG global: KnowledgeItem.orgId passa a aceitar NULL (= base de plataforma).
--
-- Idempotente (convenção do repo): pode rodar duas vezes sem efeito colateral.

-- 1. orgId nullable. A FK segue ON DELETE CASCADE; com NULL ela simplesmente
--    não é checada (MATCH SIMPLE), então nenhuma constraint precisa mudar.
ALTER TABLE "KnowledgeItem" ALTER COLUMN "orgId" DROP NOT NULL;

-- 2. Escopo por agente. Vazio = visível a todos — a coluna nasce sem tirar
--    alcance de nada que já existe.
ALTER TABLE "KnowledgeItem"
  ADD COLUMN IF NOT EXISTS "visibleToAgents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 3. A base do assistente de suporte SEMPRE foi de plataforma; só não tinha
--    onde morar, então vivia numa org-sentinela resolvida por env
--    (SUPPORT_KB_ORG_ID → SHARED_ORG_ID → "org mais antiga"). Agora tem.
UPDATE "KnowledgeItem"
   SET "orgId" = NULL
 WHERE category = 'support'
   AND "orgId" IS NOT NULL;

-- 3a. Antes de virar plataforma, a base de suporte só poluía a org-sentinela.
--     Global, ela apareceria na busca de cláusulas de TODO tenant ("o que faz a
--     tela Pipeline" no meio de um CCV). Marcamos os itens como do agente
--     `support`; o helper de escopo já exclui a categoria por conta própria —
--     isto é o cinto ao lado do suspensório, e o primeiro uso real de
--     `visibleToAgents`.
UPDATE "KnowledgeItem"
   SET "visibleToAgents" = ARRAY['support']::TEXT[]
 WHERE category = 'support'
   AND cardinality("visibleToAgents") = 0;

-- 3b. Se o seed já tiver rodado contra orgs DIFERENTES em algum momento (é
--     exatamente o que o fallback frágil permitia), o passo 3 traz as duplicatas
--     todas pro mesmo escopo. Mantém a mais recente por `source` e descarta as
--     demais — conteúdo de seed, regenerável por `seedSupportKb`. Só linhas de
--     topo: os chunks caem por cascade junto do pai descartado.
DELETE FROM "KnowledgeItem" k
 WHERE k.category = 'support'
   AND k."orgId" IS NULL
   AND k."parentId" IS NULL
   AND k.source IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM "KnowledgeItem" keep
      WHERE keep.category = 'support'
        AND keep."orgId" IS NULL
        AND keep."parentId" IS NULL
        AND keep.source = k.source
        AND (keep."updatedAt", keep.id) > (k."updatedAt", k.id)
   );
