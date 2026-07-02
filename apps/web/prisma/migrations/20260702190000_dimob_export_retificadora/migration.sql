-- DIMOB: histórico de exports guarda se é retificadora + o recibo anterior. Idempotente.

ALTER TABLE "DimobExport" ADD COLUMN IF NOT EXISTS "retificadora" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DimobExport" ADD COLUMN IF NOT EXISTS "numeroRecibo" TEXT;
