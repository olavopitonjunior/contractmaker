-- Renumera OrgFormSettings.customRequiredPaths para refletir o merge de
-- "Posse e Título" no "Status e Débitos" (8 → 7 etapas, 2026-05-16).
--
-- Antes:                       Depois:
--  0 Documentos                 0 Documentos
--  1 Vendedor                   1 Vendedor
--  2 Comprador                  2 Comprador
--  3 Imóvel                     3 Imóvel
--  4 Status/Débitos             4 Status, Posse e Débitos  ← absorve antiga 6
--  5 Pagamento                  5 Pagamento
--  6 Posse/Título  ──┐          6 Comissão/Config
--  7 Comissão     ──┘
--
-- customRequiredPaths é Json com formato [{ step: number, path: string }].
-- Entradas com `step:6` (Posse) viram `step:4` (junto com Status/Débitos);
-- entradas com `step:7` (Comissão) viram `step:6`. Steps 0..5 ficam iguais.
--
-- Idempotente: se rodada 2x, segundo run não muda nada (steps já estão em
-- 0..6, e o filtro WHERE captura só >5).

UPDATE "OrgFormSettings"
SET "customRequiredPaths" = (
  SELECT jsonb_agg(
    CASE
      WHEN (item->>'step')::int = 7 THEN jsonb_set(item, '{step}', '6'::jsonb)
      WHEN (item->>'step')::int = 6 THEN jsonb_set(item, '{step}', '4'::jsonb)
      ELSE item
    END
  )
  FROM jsonb_array_elements("customRequiredPaths"::jsonb) AS item
)
WHERE jsonb_typeof("customRequiredPaths"::jsonb) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("customRequiredPaths"::jsonb) AS item
    WHERE (item->>'step')::int > 5
  );
