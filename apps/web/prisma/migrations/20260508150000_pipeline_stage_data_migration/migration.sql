-- Pipeline SLA — data migration das stages.
-- Renomeia "Assinatura" → "Enviado para assinatura" e "Concluído" → "Comissão paga",
-- e cria 3 stages novas (Contrato assinado, Cobrança emitida, Negócio perdido) em
-- cada Pipeline existente. Idempotente — re-rodar é no-op.
--
-- @@unique([pipelineId, position]) força rebalanceamento via "parking" (positions
-- ≥ 1000) antes de aplicar positions canônicas.

DO $$
DECLARE
  pipeline_record RECORD;
BEGIN
  -- 1. Move stages atuais pra parking (libera slots de position)
  UPDATE "PipelineStage" SET position = 1000 + position WHERE position < 1000;

  -- 2. Renomeia stages antigas
  UPDATE "PipelineStage"
     SET name = 'Enviado para assinatura', color = '#3b82f6'
   WHERE name = 'Assinatura';

  UPDATE "PipelineStage"
     SET name = 'Comissão paga', color = '#22c55e'
   WHERE name = 'Concluído';

  -- 3. Cria stages novas (per pipeline, idempotente via NOT EXISTS)
  FOR pipeline_record IN SELECT id FROM "Pipeline" LOOP
    INSERT INTO "PipelineStage" (id, "pipelineId", name, color, position)
    SELECT
      'cm' || replace(gen_random_uuid()::text, '-', ''),
      pipeline_record.id,
      ns.name,
      ns.color,
      1100 + ns.tmp_pos
    FROM (VALUES
      ('Contrato assinado',  '#0ea5e9', 3),
      ('Cobrança emitida',   '#a855f7', 4),
      ('Negócio perdido',    '#ef4444', 6)
    ) AS ns(name, color, tmp_pos)
    WHERE NOT EXISTS (
      SELECT 1 FROM "PipelineStage" ps
      WHERE ps."pipelineId" = pipeline_record.id
        AND ps.name = ns.name
    );
  END LOOP;

  -- 4. Aplica positions canônicas (todas as stages estão em parking ≥ 1000)
  UPDATE "PipelineStage" SET position = 0 WHERE name = 'Formulário';
  UPDATE "PipelineStage" SET position = 1 WHERE name = 'Confecção de Contrato';
  UPDATE "PipelineStage" SET position = 2 WHERE name = 'Enviado para assinatura';
  UPDATE "PipelineStage" SET position = 3 WHERE name = 'Contrato assinado';
  UPDATE "PipelineStage" SET position = 4 WHERE name = 'Cobrança emitida';
  UPDATE "PipelineStage" SET position = 5 WHERE name = 'Comissão paga';
  UPDATE "PipelineStage" SET position = 6 WHERE name = 'Negócio perdido';

  -- 5. Sanity check: warn se sobraram stages órfãs em parking (custom user stages,
  -- não previstas no funil canônico). Não bloqueia migration — apenas log.
  IF EXISTS (SELECT 1 FROM "PipelineStage" WHERE position >= 1000) THEN
    RAISE NOTICE 'Stages custom encontradas em parking (>=1000) — revisar manualmente: %',
      (SELECT string_agg(name || ' (pipeline ' || "pipelineId" || ')', ', ')
         FROM "PipelineStage" WHERE position >= 1000);
  END IF;
END $$;
