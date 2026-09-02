-- Separa o acervo de cláusulas por ESTEIRA (compra e venda × locação).
--
-- Motivo: `groupCode` (G1..G6) sempre foi taxonomia EXCLUSIVA de compra e venda
-- — `seed-clauses-locacao.ts` diz isso e grava NULL. Sem um eixo próprio, a UI
-- abria por default numa aba vazia em tenant de locação e o RAG do agente não
-- tinha como estreitar a busca pelo tipo do contrato.
--
-- É COLUNA, e não tag, de propósito: o CONJUNTO EXATO de tags é a chave de
-- idempotência da reingestão (`ingest-clauses.ts::sameTagSet`); uma tag
-- `esteira:*` backfillada mudaria a identidade de todo acervo curado e a
-- próxima reingestão o DUPLICARIA em vez de arquivar a versão anterior.
--
-- Idempotente (IF NOT EXISTS + guarda `esteira IS NULL` em todo UPDATE):
-- re-aplicar é no-op, e nenhuma regra sobrescreve o que outra já decidiu.

ALTER TABLE "KnowledgeItem" ADD COLUMN IF NOT EXISTS "esteira" TEXT;

CREATE INDEX IF NOT EXISTS "KnowledgeItem_orgId_category_esteira_idx"
  ON "KnowledgeItem" ("orgId", "category", "esteira");

-- ---------------------------------------------------------------------------
-- Backfill DETERMINÍSTICO. Só onde há evidência no dado; nada de heurística de
-- texto. A ordem importa: R1/R2 (venda) rodam antes de R3 (que olha a tag
-- "locacao"), pra que uma cláusula de venda que por acaso tenha essa tag não
-- seja levada para locação.
-- ---------------------------------------------------------------------------

-- R1 · venda: ter groupCode é, por construção, ser cláusula de CCV.
UPDATE "KnowledgeItem" SET "esteira" = 'venda'
 WHERE "category" = 'clause' AND "esteira" IS NULL AND "groupCode" IS NOT NULL;

-- R2 · venda: banco curado de vendas (VENDAS_SEED_SOURCE).
UPDATE "KnowledgeItem" SET "esteira" = 'venda'
 WHERE "category" = 'clause' AND "esteira" IS NULL AND "source" = 'seed_vendas_v2';

-- R3 · locação: banco Lei 8.245/91 (LOCACAO_SEED_SOURCE) ou tag explícita.
UPDATE "KnowledgeItem" SET "esteira" = 'locacao'
 WHERE "category" = 'clause' AND "esteira" IS NULL
   AND ("source" = 'seed_locacao_v1' OR 'locacao' = ANY("tags"));

-- R4 · locação: cláusula de SLOT de garantia. Garantia locatícia (fiador,
-- caução, seguro-fiança...) só existe em locação — é o que traz o pacote curado
-- da Trio e as cláusulas de consolidação de modelos.
UPDATE "KnowledgeItem" SET "esteira" = 'locacao'
 WHERE "category" = 'clause' AND "esteira" IS NULL
   AND EXISTS (
     SELECT 1 FROM unnest("tags") t
      WHERE t LIKE 'slot:%' OR t LIKE 'garantia:%' OR t LIKE 'cobertura:%'
   );

-- R5 · locação: subcategorias EXCLUSIVAS de locação. Note a AUSÊNCIA de
-- 'rescisao' e de 'garantia' genérica — 'rescisao' aparece nos DOIS seeds, e
-- classificá-la aqui seria chute.
UPDATE "KnowledgeItem" SET "esteira" = 'locacao'
 WHERE "category" = 'clause' AND "esteira" IS NULL AND "groupCode" IS NULL
   AND "subcategory" IN ('vistoria','benfeitorias','reajuste','renovatoria',
                         'preferencia','devolucao','encargos','uso');

-- Todo o resto fica NULL DE PROPÓSITO: é a fila de triagem do classificador,
-- não um palpite. NULL é lido nas duas esteiras, então nada some da busca.

-- ---------------------------------------------------------------------------
-- Backfill de `isVariable`, que passou a ser DERIVADO do conteúdo.
--
-- O campo era um Switch rotulado "Cláusula padronizada (G1–G6)" — nome que não
-- descrevia o que ele guarda (só "tem placeholders") e que era independente do
-- Select de Grupo. Agora o caminho de escrita o deriva de `{{chave}}`; sem este
-- backfill, linha antiga manteria o valor digitado e a base ficaria com duas
-- semânticas convivendo (achado do review).
--
-- O regex espelha `deriveIsVariable` em lib/clauses/schema.ts: exige conteúdo
-- entre as chaves e o fechamento — `{{` solto não conta.
-- ---------------------------------------------------------------------------
UPDATE "KnowledgeItem"
   SET "isVariable" = ("content" ~ '\{\{[^{}]+\}\}')
 WHERE "category" = 'clause'
   AND "isVariable" IS DISTINCT FROM ("content" ~ '\{\{[^{}]+\}\}');
