-- Onde a PRÓPRIA imobiliária recebe a comissão de intermediação (1º aluguel).
--
-- POR QUÊ. Na reingestão dos modelos da RE/MAX Trio em produção (02/09/2026),
-- 12 dos 16 rascunhos ficaram barrados pelo gate de PII exclusivamente pela
-- conta bancária da própria imobiliária, escrita por extenso no item a) da
-- cláusula de rateio do 1º aluguel. O #518 criou a chave
-- `{{imobiliaria_dados_pagamento}}` e guardou o dado em
-- `OrgFormSettings.contractDefaultsJson.locacao_recebimento` (padrão por
-- formulário). O dono corrigiu o lugar: é dado FIXO da imobiliária, mora no
-- Perfil, ao lado de CNPJ e CRECI — logo, colunas em `Organization`.
--
-- Medido em produção antes de mover (02/09, host ep-bitter-wildflower): 4 rows
-- de OrgFormSettings, NENHUMA com `locacao_recebimento` preenchido — não há
-- dado a copiar, e a chave JSON antiga (se existir vazia) fica órfã de
-- propósito: nenhum `jsonb_set` em massa, é irreversível e não compra nada.
--
-- Nomes e domínios copiados de `SplitRecipient` (pixAddressKey/pixKeyType com
-- CPF|CNPJ|EMAIL|PHONE|EVP; bank* com bankAccountType corrente|poupanca), para
-- o texto sair pelo MESMO renderizador do repasse do corretor.
--
-- Aditiva e idempotente: só ADD COLUMN IF NOT EXISTS, tudo nullable, sem
-- índice (ninguém consulta por esses campos).

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "pixAddressKey" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "pixKeyType" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "bankBranch" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "bankAccount" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "bankAccountType" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "bankHolderName" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "bankHolderDoc" TEXT;
