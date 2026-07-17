-- Detector de mudança da análise passiva: hash do texto analisado por último.
-- Substitui o skip por ChangeLog (que não vê edições no iframe Drive).
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "lastAnalyzedTextHash" TEXT;
