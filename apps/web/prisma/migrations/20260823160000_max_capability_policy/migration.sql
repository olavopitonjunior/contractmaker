-- Política de capabilities do Max, por tenant.
--
-- ── Por que existe ────────────────────────────────────────────────────────
--
-- Hoje o Max exerce UMA capability (propor criação de formulário/proposta), e
-- quem decide se ela é oferecida é `podeEscrever` — "tem login na plataforma?".
-- A Fase 5 do copiloto leva o agente a ~9 ferramentas, incluindo leitura de
-- negócio e de proposta, e "tem login" deixa de ser uma resposta: um gerente e
-- um corretor comissionado precisam de tetos diferentes, e a imobiliária
-- precisa poder decidir isso sem deploy.
--
-- ── O que esta tabela decide, e o que ela NÃO decide ─────────────────────
--
-- Decide o teto do que o agente pode OFERECER. Não decide quais linhas voltam:
-- isso continua sendo `dealScopeWhere`/`proposalScopeWhere`, no servidor, onde
-- a política do Max não alcança. Se o escopo daquele gerente não enxerga o
-- negócio, nenhuma configuração aqui o faz aparecer.
--
-- É por isso que a política **nunca alarga** — ela só estreita o que o RBAC já
-- permitiu. As duas travas são independentes de propósito: uma é configuração
-- de tenant, a outra é autorização de plataforma.
--
-- ── Aditiva pura, e fail-closed por DEFAULT ──────────────────────────────
--
-- Tabela nova; nenhuma tabela existente é alterada. Por isso a janela entre a
-- aplicação em staging e a em produção é segura.
--
-- Os defaults `{}`/`[]` não são conveniência: são a regra 3 da governança do
-- Max (`CLAUDE.md`) em forma de schema. Toda org nasce concedendo NADA, e a
-- ausência da linha significa o mesmo que a linha vazia — os dois casos caem
-- em "nenhuma capability" do lado que lê.
--
-- Sem backfill de propósito: criar linha para as orgs existentes com algum
-- preset seria conceder capability que ninguém pediu, que é exatamente o que
-- o fail-closed existe para impedir.
CREATE TABLE "MaxCapabilityPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    -- { [rolePreset]: Capability[] } — papel ausente = nenhuma.
    "byRole" JSONB NOT NULL DEFAULT '{}',
    -- { [splitRecipientId]: { allow?: Capability[], deny?: Capability[] } }
    -- `deny` vence `allow`, sempre.
    "byRecipient" JSONB NOT NULL DEFAULT '{}',
    -- Corretor comissionado sem override. Ele não tem RBAC: é o único freio.
    "brokerDefault" JSONB NOT NULL DEFAULT '[]',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaxCapabilityPolicy_pkey" PRIMARY KEY ("id")
);

-- Uma linha por org. A granularidade fina mora nos JSONs, onde capability nova
-- não custa migration.
CREATE UNIQUE INDEX "MaxCapabilityPolicy_orgId_key" ON "MaxCapabilityPolicy"("orgId");

ALTER TABLE "MaxCapabilityPolicy"
  ADD CONSTRAINT "MaxCapabilityPolicy_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
