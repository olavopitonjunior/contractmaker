-- Unique parcial: no máximo 1 resumo de formulário por negócio.
--
-- O persist do resumo faz check-then-act (findMany → update/create) sem
-- constraint — dois cliques simultâneos ("Baixar PDF" + "Enviar") ainda podiam
-- criar 2 linhas. O índice fecha a corrida; o código trata P2002 com retry de
-- update (form-summary-mailer.ts).
--
-- 1) Saneamento ANTES do índice (obrigatório: CREATE UNIQUE INDEX aborta com
--    duplicata e derrubaria o migrate deploy do build). Mantém a linha mais
--    recente por deal (createdAt, desempate por id). Os blobs das linhas
--    removidas ficam órfãos — aceito e pontual: o blob-gc não cobre
--    form-summary/ e o volume é o das duplicatas do bug corrigido em
--    2026-08-18 (dedup por URL quebrado pelo addRandomSuffix).
DELETE FROM "DealAttachment" a
USING "DealAttachment" b
WHERE a."dealId" = b."dealId"
  AND a."source" = 'form_summary'
  AND b."source" = 'form_summary'
  AND (b."createdAt" > a."createdAt"
       OR (b."createdAt" = a."createdAt" AND b."id" > a."id"));

-- 2) Índice parcial (não @@unique no schema: 'manual' e outros sources podem
--    repetir por deal à vontade). Sem CONCURRENTLY — Prisma roda em transação;
--    o lock é curto (índice pequeno, só linhas form_summary).
CREATE UNIQUE INDEX IF NOT EXISTS "DealAttachment_dealId_form_summary_key"
  ON "DealAttachment" ("dealId")
  WHERE "source" = 'form_summary';
