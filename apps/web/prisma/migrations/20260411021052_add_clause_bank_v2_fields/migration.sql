-- AlterTable
ALTER TABLE "Clause" ADD COLUMN     "agentNotes" TEXT,
ADD COLUMN     "groupCode" TEXT,
ADD COLUMN     "isVariable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ContractTemplate" ADD COLUMN     "modalidade" TEXT DEFAULT 'a_vista';
