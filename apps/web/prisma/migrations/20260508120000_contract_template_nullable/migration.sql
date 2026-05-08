-- Make Contract.templateId nullable to support contracts imported from external uploads
-- (PDF/DOCX dropped into the rapid-deal flow — they have no Handlebars template behind them,
-- their content lives 100% in the Google Doc).
ALTER TABLE "Contract" ALTER COLUMN "templateId" DROP NOT NULL;
