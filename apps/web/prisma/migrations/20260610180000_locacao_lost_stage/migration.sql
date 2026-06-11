-- Adiciona o stage terminal "Negócio perdido" aos pipelines de LOCAÇÃO
-- existentes (paridade com vendas: mark-lost/reopen passam a funcionar por
-- pipeline.kind). Append em position MAX+1 — não colide com
-- @@unique([pipelineId, position]). Idempotente via NOT EXISTS.
-- Orgs novas ganham o stage pelo seed (scripts/seed-pipeline-locacao.ts).

DO $$
DECLARE
  pipeline_record RECORD;
BEGIN
  FOR pipeline_record IN
    SELECT id FROM "Pipeline" WHERE kind = 'locacao'
  LOOP
    INSERT INTO "PipelineStage" (id, "pipelineId", name, color, position)
    SELECT
      'cm' || replace(gen_random_uuid()::text, '-', ''),
      pipeline_record.id,
      'Negócio perdido',
      'red',
      (SELECT COALESCE(MAX(position), -1) + 1
         FROM "PipelineStage"
        WHERE "pipelineId" = pipeline_record.id)
    WHERE NOT EXISTS (
      SELECT 1 FROM "PipelineStage" ps
      WHERE ps."pipelineId" = pipeline_record.id
        AND ps.name = 'Negócio perdido'
    );

    IF FOUND THEN
      RAISE NOTICE 'Pipeline % ganhou stage "Negócio perdido"', pipeline_record.id;
    END IF;
  END LOOP;
END $$;
