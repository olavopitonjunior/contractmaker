-- Corrige o backfill de `esteira` da migration 20260901120000.
--
-- O QUE DEU ERRADO. Aquela R1 dizia "ter groupCode é, por construção, ser
-- cláusula de CCV" e escrevia `esteira = 'venda'` para todo `groupCode IS NOT
-- NULL`. A premissa é falsa e o próprio repo a falsifica: `clauseWriteSchema`
-- restringe `groupCode` a G1..G6, mas `scripts/seed-acervo-clausulas.ts` o
-- declara `z.string()` livre — e foi por ali que o acervo curado entrou em
-- produção com `groupCode` valendo 'GARANTIA' e 'OPCIONAL'.
--
-- Resultado medido em produção em 02/09/2026: 37 cláusulas de LOCAÇÃO
-- (34 'GARANTIA' + 3 'OPCIONAL', em RE/MAX Ativa e RE/MAX Trio) marcadas como
-- 'venda'. Como R1 rodava antes de R4, a regra de slot de garantia — que
-- existia justamente para essas — nunca chegou a olhá-las.
--
-- IMPACTO. `resolveClauseSlots` casa por igualdade de tag e NÃO filtra por
-- esteira, então a geração de contrato nunca quebrou. O dano é na busca do
-- agente: o filtro do RAG é `esteira IN (<esteira do contrato>, 'ambas') OR
-- esteira IS NULL`, e 'venda' fica de fora num contrato de locação. Os dois
-- tenants perderam o acervo curado de garantia na consulta do agente.
--
-- POR QUE UMA MIGRATION NOVA. A anterior já rodou; migration aplicada não se
-- edita. Em banco novo as duas rodam em ordem e esta desfaz o excesso daquela.
--
-- Idempotente: o predicado é o próprio estado errado, então re-aplicar é no-op.

-- C1 · locação: cláusula de SLOT (é a R4 da migration anterior, que R1 furou).
UPDATE "KnowledgeItem" SET "esteira" = 'locacao'
 WHERE "category" = 'clause'
   AND "esteira" = 'venda'
   AND "groupCode" IS NOT NULL
   AND "groupCode" NOT IN ('G1','G2','G3','G4','G5','G6')
   AND EXISTS (
     SELECT 1 FROM unnest("tags") t
      WHERE t LIKE 'slot:%' OR t LIKE 'garantia:%' OR t LIKE 'cobertura:%'
   );

-- C2 · locação: tag facetada que declara a esteira (ex.: 'locacao:opcional').
UPDATE "KnowledgeItem" SET "esteira" = 'locacao'
 WHERE "category" = 'clause'
   AND "esteira" = 'venda'
   AND "groupCode" IS NOT NULL
   AND "groupCode" NOT IN ('G1','G2','G3','G4','G5','G6')
   AND EXISTS (SELECT 1 FROM unnest("tags") t WHERE t LIKE 'locacao:%');

-- C3 · o resto volta para NULL, que é a fila de triagem do classificador.
-- NULL é lido nas DUAS esteiras, então nada some da busca enquanto um humano
-- não decide. Chutar 'venda' de novo seria repetir o erro que esta migration
-- conserta.
UPDATE "KnowledgeItem" SET "esteira" = NULL
 WHERE "category" = 'clause'
   AND "esteira" = 'venda'
   AND "groupCode" IS NOT NULL
   AND "groupCode" NOT IN ('G1','G2','G3','G4','G5','G6');
