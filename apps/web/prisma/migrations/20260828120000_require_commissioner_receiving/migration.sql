-- Exigência opcional dos dados de recebimento do corretor na etapa Comissão.
--
-- Por que uma COLUNA e não um path em `customRequiredPaths`:
-- os campos de PIX/conta do corretor não vivem no `SalesForm.dataJson` de
-- propósito — o dataJson é devolvido inteiro pelo GET público do formulário
-- (qualquer portador do link) e vai no resumo por e-mail, então esses dados são
-- write-only: sobem no POST e ficam no `SplitRecipient`, cuja whitelist pública
-- nunca expõe PII bancária. O mecanismo de obrigatoriedade opera sobre paths do
-- dataJson; colocá-los lá reintroduziria exatamente o vazamento que o desenho
-- evita. A exigência é satisfeita por cadastro sem pendências
-- (`SplitRecipient.pendingFields` vazio), que é o critério de "pagável" que a
-- esteira de repasse já usa.
--
-- Idempotente (`IF NOT EXISTS`): o repo tem histórico de migration abortada por
-- statement não-guardado deixando `_prisma_migrations` em estado failed e
-- travando TODO deploy de produção (P3009). Ver BUGS.md.
ALTER TABLE "OrgFormSettings"
  ADD COLUMN IF NOT EXISTS "requireCommissionerReceiving" BOOLEAN NOT NULL DEFAULT false;
