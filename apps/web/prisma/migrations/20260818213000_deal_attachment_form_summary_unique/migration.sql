-- Unique parcial: no máximo 1 resumo de formulário por negócio.
--
-- O persist do resumo faz check-then-act (find → update/create) sem
-- constraint — dois cliques simultâneos ("Baixar PDF" + "Enviar") ainda podiam
-- criar 2 linhas. O índice fecha a corrida; o código trata P2002 adotando a
-- linha vencedora (form-summary-mailer.ts).
--
-- 1) Saneamento ANTES do índice (obrigatório: CREATE UNIQUE INDEX aborta com
--    duplicata). Mantém a linha mais recente por deal (createdAt, desempate
--    por id). NUNCA deleta linha referenciada: Envelope.attachmentId é
--    onDelete: Cascade (o DELETE levaria o envelope junto — inclusive um
--    fechado, com documento assinado — sem passar pela guarda 409 da rota) e
--    CertidaoJob.attachmentId é SetNull (perderia o vínculo job→arquivo). Se
--    uma duplicata referenciada sobreviver ao lado da linha mantida, o CREATE
--    UNIQUE INDEX abaixo FALHA — de propósito: melhor um deploy quebrado e
--    triagem manual do que perda silenciosa de envelope.
--    Os blobs das linhas removidas ficam órfãos — aceito e pontual (o blob-gc
--    não cobre form-summary/; volume = duplicatas do bug corrigido em
--    2026-08-18).
DELETE FROM "DealAttachment" a
USING "DealAttachment" b
WHERE a."dealId" = b."dealId"
  AND a."source" = 'form_summary'
  AND b."source" = 'form_summary'
  AND (b."createdAt" > a."createdAt"
       OR (b."createdAt" = a."createdAt" AND b."id" > a."id"))
  AND NOT EXISTS (SELECT 1 FROM "Envelope" e WHERE e."attachmentId" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "CertidaoJob" c WHERE c."attachmentId" = a."id");

-- 2) Índice parcial (não @@unique no schema: 'manual' e outros sources podem
--    repetir por deal à vontade). Sem CONCURRENTLY — Prisma roda em transação;
--    o lock é curto (índice pequeno, só linhas form_summary).
--    ATENÇÃO (drift): o Prisma não representa índice parcial — um futuro
--    `prisma migrate dev` pode gerar `DROP INDEX` deste índice como limpeza;
--    revisar o SQL gerado de toda migration nova.
--    Janela de rolling deploy: instância velha (sem catch de P2002) pode criar
--    duplicata entre o DELETE acima e o índice; nesse caso o CREATE falha e o
--    deploy é retryable — sem perda de dado.
CREATE UNIQUE INDEX IF NOT EXISTS "DealAttachment_dealId_form_summary_key"
  ON "DealAttachment" ("dealId")
  WHERE "source" = 'form_summary';
