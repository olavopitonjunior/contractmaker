-- Rename de taxonomia da garantia locatícia: `garantia_digital` →
-- `garantia_onerosa` (decisão de produto, 2026-08-25).
--
-- "Garantia digital" nomeava o FORNECEDOR (Almada, Loft, CredAluga…), não a
-- modalidade. A modalidade é "garantia onerosa"; o fornecedor segue vivendo em
-- `provider` / tag `provider:<slug>`, que é a dimensão secundária do slot de
-- cláusula. Nenhum fornecedor é citado neste SQL de propósito — a lista varia
-- por imobiliária.
--
-- Idempotente: todo statement tem WHERE que só alcança linha com o valor
-- LEGADO, então rodar duas vezes não muda nada e rodar num banco já limpo é
-- no-op. Complementa (não substitui) o `normalizeGarantiaTipo` de
-- lib/contracts/template-category.ts, que é a compatibilidade de LEITURA pro
-- que não é alcançável daqui.
--
-- Fora de escopo DELIBERADO: `Contract.dataJson`. É o snapshot congelado do
-- documento gerado/assinado — reescrevê-lo alteraria o dado que lastreia um
-- contrato já emitido. Contrato antigo re-renderizado passa pelo normalizador
-- em `enrichLocacaoData`.

-- 1. SalesForm.dataJson — a fonte primária do form de locação (é `deal.form`
--    que a geração lê; `Deal.dataJson` é o fallback).
UPDATE "SalesForm"
SET "dataJson" = jsonb_set(
      "dataJson"::jsonb,
      '{garantia,tipo}',
      '"garantia_onerosa"'::jsonb,
      false
    )
WHERE "dataJson"::jsonb #>> '{garantia,tipo}' = 'garantia_digital';

-- 2. Deal.dataJson — deals criados antes do SalesForm, ou sem form vinculado.
UPDATE "Deal"
SET "dataJson" = jsonb_set(
      "dataJson"::jsonb,
      '{garantia,tipo}',
      '"garantia_onerosa"'::jsonb,
      false
    )
WHERE "dataJson" IS NOT NULL
  AND "dataJson"::jsonb #>> '{garantia,tipo}' = 'garantia_digital';

-- 3. Proposal.dataJson — a proposta de locação grava o MESMO shape canônico
--    (`buildProposalDataJson` em lib/proposals/form-data.ts).
UPDATE "Proposal"
SET "dataJson" = jsonb_set(
      "dataJson"::jsonb,
      '{garantia,tipo}',
      '"garantia_onerosa"'::jsonb,
      false
    )
WHERE "dataJson"::jsonb #>> '{garantia,tipo}' = 'garantia_digital';

-- 4. GarantiaOption.tipo — catálogo de garantias da imobiliária.
--    O @@unique([orgId, tipo, provider]) pode colidir se a org já cadastrou o
--    mesmo par sob o nome novo: nesse caso a linha legada é REMOVIDA (o par
--    canônico já existe) em vez de derrubar a migration.
DELETE FROM "GarantiaOption" legado
WHERE legado."tipo" = 'garantia_digital'
  AND EXISTS (
    SELECT 1 FROM "GarantiaOption" novo
    WHERE novo."orgId" = legado."orgId"
      AND novo."tipo" = 'garantia_onerosa'
      AND novo."provider" = legado."provider"
  );

UPDATE "GarantiaOption"
SET "tipo" = 'garantia_onerosa'
WHERE "tipo" = 'garantia_digital';

-- 5. Guarantee.tipo — garantia contratada de um LeaseContract (o wizard de
--    locação e o ContratarGarantiaDialog gravam o mesmo vocabulário).
UPDATE "Guarantee"
SET "tipo" = 'garantia_onerosa'
WHERE "tipo" = 'garantia_digital';

-- 6. KnowledgeItem.tags — cláusula do acervo é eleita por tag exata
--    (`slot:garantia` + `garantia:<tipo>`, ver lib/templates/clause-slots.ts).
--    Sem este passo a cláusula da org ficaria inalcançável e todo contrato de
--    garantia onerosa sairia com o texto canônico de fallback.
UPDATE "KnowledgeItem"
SET "tags" = array_replace("tags", 'garantia:garantia_digital', 'garantia:garantia_onerosa')
WHERE 'garantia:garantia_digital' = ANY("tags");

-- 7. ContractTemplate.matchCriteria — critério que escolhe a VARIANTE do
--    modelo a partir dos fatos do formulário.
UPDATE "ContractTemplate"
SET "matchCriteria" = jsonb_set(
      "matchCriteria"::jsonb,
      '{garantia}',
      '"garantia_onerosa"'::jsonb,
      false
    )
WHERE "matchCriteria" IS NOT NULL
  AND "matchCriteria"::jsonb ->> 'garantia' = 'garantia_digital';

-- 8. ContractTemplate.handlebarsSource — modelo da imobiliária que embute a
--    condicional `{{#if (eq garantia.tipo "garantia_digital")}}`.
--    OBRIGATÓRIO junto com os passos acima: o dado passa a chegar canônico, e
--    um modelo que ainda compara com o literal antigo cairia no `{{else}}`
--    genérico — o contrato sairia SEM a cláusula de garantia correta.
--    Substituição de literal dentro da condicional apenas; o texto da cláusula
--    não é tocado.
UPDATE "ContractTemplate"
SET "handlebarsSource" = replace(
      "handlebarsSource",
      'garantia.tipo "garantia_digital"',
      'garantia.tipo "garantia_onerosa"'
    )
WHERE "handlebarsSource" LIKE '%garantia.tipo "garantia_digital"%';
