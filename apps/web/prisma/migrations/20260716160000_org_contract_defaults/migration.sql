-- Padrão de configurações contratuais por imobiliária.
--
-- As configurações (multas, juros, foro, desistência, local/data de assinatura)
-- saíram da última etapa do formulário público e viraram decisão da org:
-- aplicadas na geração (lib/services/contract-generation.ts::enrichContractData)
-- e editáveis na aba "Configurações" do contrato.
--
-- Json NOT NULL com DEFAULT '{}': sem o default, as rows existentes violariam o
-- NOT NULL (23502) na hora do ALTER. `{}` resolve pro padrão de fábrica em
-- lib/contracts/default-config.ts, então nenhum backfill é necessário e o
-- comportamento de quem não configurar nada não muda.
--
-- Idempotente (IF NOT EXISTS) — migrations rodam via `prisma migrate deploy` no
-- build e podem ser reaplicadas.
ALTER TABLE "OrgFormSettings"
  ADD COLUMN IF NOT EXISTS "contractDefaultsJson" JSONB NOT NULL DEFAULT '{}';
