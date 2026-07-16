-- Remove os campos INERTES de `config` do dataJson de forms/deals/contratos.
--
-- ## Por que isso é necessário
--
-- Até agora, `config.multa_penal_moratoria`, `base_calculo_multa`,
-- `juros_mensais_atraso`, `atualizacao_monetaria`, `prazo_atraso_rescisao`,
-- `multa_cominatoria_diaria`, `multa_penal_compensatoria` e
-- `prazo_multa_rescisoria` eram COLETADOS pelo formulário e IGNORADOS pelos
-- templates v2 — os números viviam escritos à mão no texto das cláusulas. O
-- wizard gravava seus próprios defaults no dataJson via autosave, e eles
-- DIVERGIAM do texto praticado:
--
--     campo                      | wizard (gravado) | cláusula (praticada)
--     ---------------------------|------------------|---------------------
--     multa_penal_compensatoria  | 10               | 5
--     multa_cominatoria_diaria   | 150              | 500
--     prazo_atraso_rescisao      | 10               | 15
--     prazo_multa_rescisoria     | 7                | 30
--     base_calculo_multa         | "valor da parcela" | "valor da obrigação inadimplida"
--     atualizacao_monetaria      | "IPCA"           | "IPCA/IBGE"
--
-- Agora que as cláusulas leem `config.*`, esses valores legados passariam a
-- VALER — e como `enrichContractData` é aditivo (só preenche o ausente), eles
-- venceriam o padrão de fábrica. Um contrato gerado a partir de um form
-- preenchido antes deste deploy sairia com "reterão 10% (dez por cento)" e
-- "multa diária de R$ 150,00" no lugar dos 5% / R$ 500,00 praticados —
-- dobrando as perdas e danos, sem ninguém notar.
--
-- Como eram inertes, nenhum desses valores foi uma DECISÃO de alguém: são
-- defaults de UI que vazaram pro banco. Removê-los é lossless e faz o enrich
-- cair no padrão (da org, ou de fábrica), que é o texto que os contratos já
-- praticavam. Escolhas futuras vêm da aba Configurações, que grava de novo.
--
-- Escopo: NÃO toca contratos aprovados (imutáveis; o texto deles está congelado
-- no GDoc/PDF da ClickSign de qualquer forma) nem o template legado
-- `contrato_compra_venda.hbs`, que é o único que lia esses campos — contratos
-- presos a ele mantêm o dataJson intacto.
--
-- Idempotente: `#-` sobre chave ausente é no-op, e o WHERE não casa na segunda
-- execução.

-- SalesForm
UPDATE "SalesForm"
SET "dataJson" = "dataJson"
      #- '{config,multa_penal_moratoria}'
      #- '{config,base_calculo_multa}'
      #- '{config,juros_mensais_atraso}'
      #- '{config,atualizacao_monetaria}'
      #- '{config,prazo_atraso_rescisao}'
      #- '{config,multa_cominatoria_diaria}'
      #- '{config,multa_penal_compensatoria}'
      #- '{config,prazo_multa_rescisoria}'
WHERE jsonb_typeof("dataJson" -> 'config') = 'object'
  AND "dataJson" -> 'config' ?| array[
  'multa_penal_moratoria','base_calculo_multa','juros_mensais_atraso',
  'atualizacao_monetaria','prazo_atraso_rescisao','multa_cominatoria_diaria',
  'multa_penal_compensatoria','prazo_multa_rescisoria'
];

-- Deal
UPDATE "Deal"
SET "dataJson" = "dataJson"
      #- '{config,multa_penal_moratoria}'
      #- '{config,base_calculo_multa}'
      #- '{config,juros_mensais_atraso}'
      #- '{config,atualizacao_monetaria}'
      #- '{config,prazo_atraso_rescisao}'
      #- '{config,multa_cominatoria_diaria}'
      #- '{config,multa_penal_compensatoria}'
      #- '{config,prazo_multa_rescisoria}'
WHERE jsonb_typeof("dataJson" -> 'config') = 'object'
  AND "dataJson" -> 'config' ?| array[
  'multa_penal_moratoria','base_calculo_multa','juros_mensais_atraso',
  'atualizacao_monetaria','prazo_atraso_rescisao','multa_cominatoria_diaria',
  'multa_penal_compensatoria','prazo_multa_rescisoria'
];

-- Contract — só os NÃO aprovados e que não usam o template legado.
UPDATE "Contract" c
SET "dataJson" = c."dataJson"
      #- '{config,multa_penal_moratoria}'
      #- '{config,base_calculo_multa}'
      #- '{config,juros_mensais_atraso}'
      #- '{config,atualizacao_monetaria}'
      #- '{config,prazo_atraso_rescisao}'
      #- '{config,multa_cominatoria_diaria}'
      #- '{config,multa_penal_compensatoria}'
      #- '{config,prazo_multa_rescisoria}'
WHERE c."status" <> 'aprovado'
  AND jsonb_typeof(c."dataJson" -> 'config') = 'object'
  AND c."dataJson" -> 'config' ?| array[
    'multa_penal_moratoria','base_calculo_multa','juros_mensais_atraso',
    'atualizacao_monetaria','prazo_atraso_rescisao','multa_cominatoria_diaria',
    'multa_penal_compensatoria','prazo_multa_rescisoria'
  ]
  AND NOT EXISTS (
    SELECT 1 FROM "ContractTemplate" t
    WHERE t.id = c."templateId"
      AND t."handlebarsSource" LIKE '%config.multa_penal_moratoria%'
  );
