-- Backfill: deals com Envelope source="contract" status="closed" mas que
-- ficaram parados em stages anteriores ("Formulário", "Confecção de Contrato",
-- "Enviado para assinatura"). Caso típico: webhook ClickSign close não chegou
-- ou explodiu silenciosamente no try/catch antigo, deixando o envelope
-- atualizado mas o stage do deal pra trás.
--
-- Idempotente: usa JOIN com filtro pra só promover quem ainda está atrás;
-- rodar múltiplas vezes não tem efeito.

UPDATE "Deal" d
SET "stageId" = ts.id, "updatedAt" = NOW()
FROM "PipelineStage" cs, "PipelineStage" ts, "Envelope" e
WHERE d."stageId" = cs.id
  AND cs."pipelineId" = ts."pipelineId"
  AND cs.name IN ('Formulário', 'Confecção de Contrato', 'Enviado para assinatura')
  AND ts.name = 'Contrato assinado'
  AND e."dealId" = d.id
  AND e.source = 'contract'
  AND e.status = 'closed'
  AND e."closedAt" IS NOT NULL;
