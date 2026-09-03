-- Locação: locatário passa a ser a etapa 1 e locador a etapa 2.
--
-- O índice da etapa é IDENTIDADE PERSISTIDA em duas colunas de OrgFormSettings:
--   1. locacaoCustomRequiredPaths -> [{ path, step }]
--   2. participantVisibilityJson  -> { locacao: { <papel>: [índices] } }
--
-- Sem este remapeamento, uma org já configurada passaria a exigir campos na
-- etapa errada, e — pior — o link público de um papel ganharia escopo de
-- ESCRITA sobre os dados do outro (os data-paths de um subtoken derivam das
-- etapas, ver lib/forms/participant-visibility.ts).
--
-- IDEMPOTÊNCIA. Uma troca literal 1<->2 é uma involução: rodar duas vezes
-- desfaz, e nenhum WHERE distingue "já trocado" de "ainda não". Duas defesas:
--   (a) locacaoCustomRequiredPaths é RECALCULADO a partir do próprio path, não
--       trocado. Recomputar converge: rodar de novo dá o mesmo resultado.
--   (b) participantVisibilityJson só tem índices, não há de onde recomputar —
--       ali vale o marcador locacaoStepSchemaVersion, que viaja com a linha e
--       por isso sobrevive ao sync-prod-to-staging.ts (que copia linhas de prod
--       para uma staging já migrada).

-- Marcador de versão. Linhas existentes nascem em v1 (esquema antigo); o
-- default da coluna é 2, então toda linha criada daqui pra frente já nasce nova.
ALTER TABLE "OrgFormSettings"
  ADD COLUMN IF NOT EXISTS "locacaoStepSchemaVersion" INTEGER NOT NULL DEFAULT 1;

-- (a) Recalcula o `step` de cada item a partir do prefixo do próprio `path`.
-- Convergente: o path é a fonte de verdade e não muda. Itens sem `path` string
-- ou com prefixo desconhecido são preservados como estão.
UPDATE "OrgFormSettings" AS s
SET "locacaoCustomRequiredPaths" = COALESCE(remapped.arr, '[]'::jsonb)
FROM (
  SELECT
    o."id" AS id,
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(item -> 'path') <> 'string' THEN item
        WHEN item ->> 'path' = 'locatarios' OR item ->> 'path' LIKE 'locatarios.%'
          THEN jsonb_set(item, '{step}', to_jsonb(1))
        WHEN item ->> 'path' = 'locadores' OR item ->> 'path' LIKE 'locadores.%'
          THEN jsonb_set(item, '{step}', to_jsonb(2))
        WHEN item ->> 'path' LIKE 'imovel.%'
          THEN jsonb_set(item, '{step}', to_jsonb(3))
        WHEN item ->> 'path' LIKE 'aluguel.%'
          THEN jsonb_set(item, '{step}', to_jsonb(4))
        WHEN item ->> 'path' LIKE 'garantia.%' OR item ->> 'path' = 'observacoes'
          THEN jsonb_set(item, '{step}', to_jsonb(5))
        WHEN item ->> 'path' LIKE 'comissao.%'
          THEN jsonb_set(item, '{step}', to_jsonb(6))
        ELSE item
      END
      ORDER BY ord
    ) AS arr
  FROM "OrgFormSettings" o
  CROSS JOIN LATERAL jsonb_array_elements(o."locacaoCustomRequiredPaths"::jsonb)
    WITH ORDINALITY AS t(item, ord)
  WHERE jsonb_typeof(o."locacaoCustomRequiredPaths"::jsonb) = 'array'
  GROUP BY o."id"
) AS remapped
WHERE s."id" = remapped.id;

-- (b) Troca 1<->2 nos arrays de etapas visíveis por papel, SÓ na sub-árvore de
-- locação e SÓ em linha ainda marcada como v1. Venda não é tocada.
--
-- Duas defesas que este bloco NÃO tinha na primeira versão, e que o bloco (a)
-- já tinha (a assimetria era o bug):
--
--   * PRESERVAR o que não se reconhece, em vez de estourar ou apagar. Elemento
--     não-numérico dentro do array e papel cujo valor não é array passam
--     intactos. Antes, um `null` no array abortava a TRANSAÇÃO INTEIRA — e como
--     `prisma migrate deploy` roda no build, isso derrubava o deploy todo, de
--     todas as orgs, não só a que tinha o dado ruim. E um papel não-array era
--     silenciosamente DESCARTADO, porque o `WHERE ... = 'array'` filtrava a
--     linha antes do `jsonb_object_agg` reconstruir o objeto.
--
--   * Extrair como TEXTO antes do `::int` (`#>> '{}'`), que é o idioma da
--     migration irmã já em produção (20260516120000_form_step_renumber). O cast
--     direto `jsonb::int` só existe a partir do Postgres 17 — depender dele
--     amarra a migration à major do banco sem necessidade.
UPDATE "OrgFormSettings" AS s
SET "participantVisibilityJson" = jsonb_set(
      s."participantVisibilityJson"::jsonb,
      '{locacao}',
      COALESCE(
        (
          SELECT jsonb_object_agg(
            papel,
            CASE
              WHEN jsonb_typeof(etapas) <> 'array' THEN etapas
              ELSE (
                SELECT COALESCE(jsonb_agg(
                  CASE
                    WHEN jsonb_typeof(e.val) <> 'number' THEN e.val
                    WHEN (e.val #>> '{}')::int = 1 THEN to_jsonb(2)
                    WHEN (e.val #>> '{}')::int = 2 THEN to_jsonb(1)
                    ELSE e.val
                  END
                  ORDER BY e.pos
                ), '[]'::jsonb)
                FROM jsonb_array_elements(etapas) WITH ORDINALITY AS e(val, pos)
              )
            END
          )
          FROM jsonb_each(s."participantVisibilityJson"::jsonb -> 'locacao')
            AS pares(papel, etapas)
        ),
        s."participantVisibilityJson"::jsonb -> 'locacao'
      )
    )
WHERE s."locacaoStepSchemaVersion" = 1
  AND s."participantVisibilityJson" IS NOT NULL
  AND jsonb_typeof(s."participantVisibilityJson"::jsonb) = 'object'
  AND jsonb_typeof(s."participantVisibilityJson"::jsonb -> 'locacao') = 'object';

-- Fecha o marcador. A partir daqui a linha está no esquema v2.
UPDATE "OrgFormSettings" SET "locacaoStepSchemaVersion" = 2 WHERE "locacaoStepSchemaVersion" = 1;

ALTER TABLE "OrgFormSettings" ALTER COLUMN "locacaoStepSchemaVersion" SET DEFAULT 2;
