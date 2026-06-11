-- DefaultWitness — cadastro de testemunhas padrão do sistema (por org).
-- Idempotente: IF NOT EXISTS pra sobreviver a re-run em prod/staging.

CREATE TABLE IF NOT EXISTS "DefaultWitness" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "email" TEXT NOT NULL,
    "mobilePhone" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefaultWitness_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DefaultWitness_orgId_idx" ON "DefaultWitness"("orgId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'DefaultWitness_orgId_fkey'
    ) THEN
        ALTER TABLE "DefaultWitness"
            ADD CONSTRAINT "DefaultWitness_orgId_fkey"
            FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
