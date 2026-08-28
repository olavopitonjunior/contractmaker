-- 3º ciclo do revisor pós-geração: PROPOSTAS entram na mesma máquina de run.
--
-- O alvo do run vira uma união: contrato OU proposta, exatamente um. A tabela
-- não foi duplicada de propósito — claim, sweeper, rotas e relatório semanal
-- são idênticos; só o executor ramifica pelo alvo. O CHECK abaixo garante no
-- banco o que o Prisma não modela (dois nullable ≠ união disciplinada).
ALTER TABLE "ContractReviewRun" ALTER COLUMN "contractId" DROP NOT NULL;
ALTER TABLE "ContractReviewRun" ADD COLUMN "proposalId" TEXT;

ALTER TABLE "ContractReviewRun" ADD CONSTRAINT "ContractReviewRun_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ContractReviewRun_proposalId_idx" ON "ContractReviewRun"("proposalId");

ALTER TABLE "ContractReviewRun" ADD CONSTRAINT "ContractReviewRun_target_one_of"
    CHECK (("contractId" IS NULL) <> ("proposalId" IS NULL));
