/*
  Warnings:

  - You are about to drop the column `htmlPreview` on the `Contract` table. All the data in the column will be lost.
  - You are about to drop the column `s3Url` on the `Export` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Export` table. All the data in the column will be lost.
  - You are about to drop the `Template` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `userId` to the `ChatSession` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dealId` to the `Contract` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Contract` table without a default value. This is not possible if the table is not empty.
  - Added the required column `format` to the `Export` table without a default value. This is not possible if the table is not empty.
  - Added the required column `url` to the `Export` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_contractId_fkey";

-- DropForeignKey
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_templateId_fkey";

-- DropForeignKey
ALTER TABLE "Export" DROP CONSTRAINT "Export_contractId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_sourceDocId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_userId_fkey";

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Contract" DROP COLUMN "htmlPreview",
ADD COLUMN     "dealId" TEXT NOT NULL,
ADD COLUMN     "htmlContent" TEXT,
ADD COLUMN     "isLatest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parentVersionId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "status" SET DEFAULT 'rascunho';

-- AlterTable
ALTER TABLE "Export" DROP COLUMN "s3Url",
DROP COLUMN "type",
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "format" TEXT NOT NULL,
ADD COLUMN     "url" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" TIMESTAMP(3),
ADD COLUMN     "image" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- DropTable
DROP TABLE "Template";

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',

    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Pipeline Principal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "formId" TEXT,
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "dataJson" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealAttachment" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesForm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "title" TEXT,
    "schemaType" TEXT NOT NULL DEFAULT 'compra_venda_v1',
    "dataJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "schemaType" TEXT NOT NULL DEFAULT 'compra_venda_v1',
    "handlebarsSource" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'handlebars',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clause" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "authorId" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractClause" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "overrideContent" TEXT,

    CONSTRAINT "ContractClause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourceDocId" TEXT NOT NULL,
    "handlebarsTemplate" TEXT NOT NULL,
    "analysisJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMembership_userId_orgId_key" ON "OrgMembership"("userId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_position_key" ON "PipelineStage"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_formId_key" ON "Deal"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesForm_token_key" ON "SalesForm"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ContractClause_contractId_clauseId_key" ON "ContractClause"("contractId", "clauseId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyTemplate_sourceDocId_key" ON "LegacyTemplate"("sourceDocId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_formId_fkey" FOREIGN KEY ("formId") REFERENCES "SalesForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealAttachment" ADD CONSTRAINT "DealAttachment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesForm" ADD CONSTRAINT "SalesForm_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clause" ADD CONSTRAINT "Clause_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clause" ADD CONSTRAINT "Clause_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractClause" ADD CONSTRAINT "ContractClause_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractClause" ADD CONSTRAINT "ContractClause_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "Clause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyTemplate" ADD CONSTRAINT "LegacyTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyTemplate" ADD CONSTRAINT "LegacyTemplate_sourceDocId_fkey" FOREIGN KEY ("sourceDocId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
