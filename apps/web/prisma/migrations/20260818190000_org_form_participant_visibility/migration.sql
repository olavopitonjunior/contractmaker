-- Visibilidade de seções por link de parte (namespaced venda/locacao).
-- Null = defaults em código (lib/forms/participant-visibility.ts).
-- Aditiva e idempotente.
ALTER TABLE "OrgFormSettings" ADD COLUMN IF NOT EXISTS "participantVisibilityJson" JSONB;
