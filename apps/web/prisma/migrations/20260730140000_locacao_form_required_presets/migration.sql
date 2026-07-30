-- Obrigatoriedade configurável do formulário público também para LOCAÇÃO.
--
-- OrgFormSettings ganha o par espelhado do de venda (preset + override fino).
-- Default "legado" preserva o comportamento atual da esteira de locação: nada
-- obrigatório além do piso do wizard (nome da parte, descrição do imóvel,
-- valor do aluguel). Org só passa a exigir campos depois de escolher um preset
-- na tela /settings/formulario.
--
-- SalesForm.requiredPreset é o SNAPSHOT do preset vigente na criação do
-- formulário (gravado só pelos caminhos de locação). NULL = formulário criado
-- antes desta feature → segue pelo comportamento antigo, mesmo que a org
-- configure um preset depois. Sem ele, mudar a configuração endureceria links
-- já entregues ao cliente no meio do preenchimento.
--
-- Aditiva e idempotente (prisma migrate deploy roda no build).
ALTER TABLE "OrgFormSettings"
  ADD COLUMN IF NOT EXISTS "locacaoPreset" TEXT NOT NULL DEFAULT 'legado';

ALTER TABLE "OrgFormSettings"
  ADD COLUMN IF NOT EXISTS "locacaoCustomRequiredPaths" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "SalesForm"
  ADD COLUMN IF NOT EXISTS "requiredPreset" TEXT;
