# ContractMaker — Módulo de Certidões e Diligências Documentais

**Mapeamento Operacional para Compra e Venda de Imóveis**

Vendedor (Pessoa Física e Pessoa Jurídica) e Imóvel — Esferas Federal, Estadual e Municipal

São Paulo • Porto Alegre • Rio de Janeiro • Curitiba • Florianópolis • Belo Horizonte • Vitória • Cuiabá • Campo Grande

*Versão de referência operacional — abril de 2026*

---

## 1. Introdução e finalidade do documento

Este documento consolida o mapeamento operacional das certidões e diligências documentais exigíveis em transações de compra e venda de imóveis no Brasil, abrangendo a esfera federal e os nove estados de interesse, com as respectivas capitais. O propósito é alimentar o módulo de certidões do ContractMaker com regras de negócio claras, permitindo que o sistema interprete corretamente cada certidão recebida e oriente o fluxo do contrato com base na situação fática de cada transação.

O documento está estruturado em três trilhas independentes — Vendedor Pessoa Física, Vendedor Pessoa Jurídica e Imóvel — para facilitar o roteamento condicional pelo sistema. Quando uma mesma certidão se aplica a mais de uma trilha, ela é descrita em ambas, com as particularidades de cada uma.

### 1.1. Como o documento está organizado

A estrutura segue uma lógica federativa, do mais geral ao mais específico:

- **Esfera federal**: certidões emitidas por órgãos federais, válidas em todo o território nacional, com regras uniformes para todos os estados.
- **Esfera estadual**: certidões emitidas por tribunais e fazendas estaduais, com regras e portais distintos para cada um dos nove estados.
- **Esfera municipal**: certidões emitidas pelas prefeituras das nove capitais, com particularidades tributárias e cadastrais próprias.
- **Trilhas separadas**: dentro de cada esfera, as certidões aplicáveis a Vendedor Pessoa Física, Vendedor Pessoa Jurídica e Imóvel são descritas em blocos distintos.
- **Situações especiais**: ao final, são tratados os casos que demandam diligência adicional — vendedor estrangeiro, espólio, menor, separação ou divórcio em curso, falência ou recuperação judicial, e venda por procuração.

### 1.2. Estrutura de cada certidão

Cada certidão é apresentada em um bloco padronizado com oito campos, projetado para alimentação direta do banco de regras do sistema:

- **Nome oficial**: denominação técnica utilizada pelo órgão expedidor.
- **Órgão expedidor**: entidade responsável pela emissão da certidão.
- **Link ou portal**: endereço eletrônico oficial para emissão.
- **Prazo de emissão**: tempo médio entre o pedido e a disponibilização do documento.
- **Validade**: período durante o qual a certidão mantém eficácia probatória.
- **Formato de saída**: tipo de arquivo gerado e características de autenticação.
- **Classificações possíveis**: estados que a certidão pode assumir e o significado prático de cada um.
- **Regras de negócio (ContractMaker)**: orientações operacionais para o sistema — quando exigir, quando dispensar, qual ação disparar diante de cada classificação, e implicações contratuais.

### 1.3. Convenções terminológicas

Para uniformidade ao longo do documento, adotam-se as seguintes convenções:

- **Vendedor PF** designa a pessoa natural alienante, isolada ou em conjunto com cônjuge.
- **Vendedor PJ** designa a pessoa jurídica alienante, regularmente constituída.
- **Imóvel** designa o objeto da transação, sendo a matrícula no Cartório de Registro de Imóveis a fonte primária de identificação.
- **Certidão negativa** atesta a inexistência de débitos, pendências ou apontamentos no escopo pesquisado.
- **Certidão positiva** atesta a existência de débitos, pendências ou apontamentos no escopo pesquisado.
- **Certidão positiva com efeito de negativa** atesta a existência de pendências, mas com exigibilidade suspensa por garantia, parcelamento, decisão judicial ou outro motivo legal — o que produz, para fins jurídicos, os mesmos efeitos da negativa.

### 1.4. Princípio operacional do módulo

O ContractMaker deve, em regra, exigir todas as certidões aplicáveis ao caso e classificá-las automaticamente conforme o resultado retornado pela integração. Diante de classificação positiva pura, o sistema deve sinalizar o apontamento ao corretor responsável e exigir a complementação por meio de certidão de objeto e pé ou documento esclarecedor, antes de liberar a minuta para assinatura. Esta lógica reflete a prática consolidada nos contratos da base de conhecimento, que tratam o apontamento positivo como evento que prorroga prazos contratuais e impõe à parte afetada o ônus do esclarecimento.

---

## 2. Esfera federal

As certidões federais têm aplicação uniforme em todos os nove estados e capitais cobertos por este documento. São o ponto de partida da diligência documental em qualquer transação imobiliária e devem ser exigidas em todas as operações, independentemente da localização do imóvel ou do domicílio das partes.

### 2.1. Vendedor Pessoa Física

#### 2.1.1. Certidão Conjunta de Débitos Relativos a Tributos Federais e à Dívida Ativa da União

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Conjunta Negativa de Débitos Relativos a Tributos Federais e à Dívida Ativa da União (CND Federal Conjunta — PGFN/RFB). |
| **Órgão expedidor** | Receita Federal do Brasil (RFB) e Procuradoria-Geral da Fazenda Nacional (PGFN), de forma unificada. |
| **Link / Portal** | https://servicos.receitafederal.gov.br/servico/certidoes |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências cadastrais. Quando há indisponibilidade automática, a emissão pode exigir atendimento presencial em unidade da Receita Federal. |
| **Validade** | 180 dias contados da data de emissão (Portaria Conjunta PGFN/RFB nº 2/2005, art. 12). |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de controle para verificação de autenticidade nos portais da RFB e da PGFN. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos perante RFB e PGFN. **Positiva com efeito de negativa**: existência de débitos com exigibilidade suspensa (parcelamento, garantia, decisão judicial). **Positiva**: existência de débitos exigíveis. A indisponibilidade da emissão online também é uma classificação operacional, indicando insuficiência de dados na base da Receita. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória em toda transação. Se negativa ou positiva com efeito de negativa, prosseguir o fluxo. Se positiva pura, bloquear a minuta e solicitar regularização ou apresentação de declaração da parte sobre a natureza do débito. Se indisponibilidade for retornada, o sistema deve aceitar declaração formal do vendedor sob responsabilidade civil e criminal de inexistência de passivo fiscal capaz de gerar insolvência, conforme prática consolidada na base de contratos para situações de indisponibilidade técnica. |

#### 2.1.2. Certidão Negativa de Débitos Trabalhistas

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Trabalhistas (CNDT). |
| **Órgão expedidor** | Tribunal Superior do Trabalho (TST), com base no Banco Nacional de Devedores Trabalhistas (BNDT). |
| **Link / Portal** | https://cndt-certidao.tst.jus.br |
| **Prazo de emissão** | Imediato. A emissão é eletrônica, gratuita e gerada automaticamente após informar CPF. |
| **Validade** | 180 dias contados da data de emissão (Lei nº 12.440/2011). |
| **Formato de saída** | Arquivo PDF, com autenticação verificável no portal do TST. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos trabalhistas inadimplidos em execução definitiva. **Positiva**: existência de débito em execução definitiva, após decorrido o prazo de regularização de 30 dias contado da inclusão no BNDT. **Positiva com efeito de negativa**: devedor que garantiu o juízo ou cuja exigibilidade está suspensa. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória em toda transação. Apesar de tratar-se de pessoa física, é frequente que vendedores tenham débitos trabalhistas como empregadores domésticos, autônomos ou profissionais liberais. Se positiva, exigir certidão de objeto e pé do processo trabalhista para verificar se há risco de constrição patrimonial sobre o imóvel (penhora, indisponibilidade). |

#### 2.1.3. Certidão Negativa da Justiça Federal

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Justiça Federal (1ª e 2ª instâncias). |
| **Órgão expedidor** | Conselho da Justiça Federal (CJF) e Tribunais Regionais Federais (TRF1 a TRF6), por meio do Sistema de Certidão Unificada da Justiça Federal. |
| **Link / Portal** | https://certidao-unificada.cjf.jus.br |
| **Prazo de emissão** | Imediato para certidão negativa. Quando há apontamentos, emissão sujeita a análise pode levar de 5 a 10 dias úteis. |
| **Validade** | Não há prazo legal único. A prática de mercado consolidada pelos contratos da base é exigir certidão expedida há, no máximo, 30 dias da data da escritura ou assinatura do CCV. Para fins de financiamento bancário, os agentes financeiros costumam exigir abrangência de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com QR Code e código de validação no portal do TRF da respectiva região. |
| **Classificações possíveis** | **Negativa**: inexistência de processos cíveis ou criminais na Justiça Federal. **Positiva**: existência de processos com indicação dos autos. A certidão pode ser emitida com abrangência regional (uma única seção judiciária) ou nacional (todas as seções). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O sistema deve, por padrão, solicitar a certidão com abrangência da seção judiciária do domicílio do vendedor e da localização do imóvel — quando distintas. Se positiva, exigir certidão de objeto e pé de cada processo apontado. Atentar para execuções fiscais federais que possam gerar indisponibilidade de bens. |

#### 2.1.4. Certidão de Antecedentes Criminais da Polícia Federal

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Antecedentes Criminais. |
| **Órgão expedidor** | Polícia Federal (PF). |
| **Link / Portal** | https://www.gov.br/pf/pt-br/assuntos/antecedentes-criminais |
| **Prazo de emissão** | Imediato quando emitida pela internet. |
| **Validade** | 90 dias, conforme prática administrativa da PF. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de validação. |
| **Classificações possíveis** | **Nada consta**: inexistência de registros criminais. **Consta**: existência de registros, com necessidade de aprofundamento. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa em transações entre particulares, mas pode ser exigida por instituições financeiras em operações de financiamento. O sistema deve marcar como opcional por padrão e ativar sua exigência apenas quando o tipo de transação envolver agente financeiro que a requeira. |

#### 2.1.5. Consulta Cadastral CPF na Receita Federal

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Comprovante de Inscrição e de Situação Cadastral no CPF. |
| **Órgão expedidor** | Receita Federal do Brasil (RFB). |
| **Link / Portal** | https://servicos.receitafederal.gov.br/servico/cpf |
| **Prazo de emissão** | Imediato. |
| **Validade** | Sem prazo formal de validade. Recomenda-se emissão na data ou em até 30 dias da assinatura do contrato. |
| **Formato de saída** | Arquivo PDF, com data e hora da consulta. |
| **Classificações possíveis** | **Regular**: cadastro ativo e em situação regular. **Suspensa, pendente de regularização, cancelada ou nula**: situações que impedem ou comprometem a validade dos atos do contribuinte. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Se a situação for diferente de regular, bloquear a minuta. Esta consulta é o primeiro filtro do sistema, pois um CPF irregular invalida toda a operação subsequente. Para estrangeiros, a consulta segue o mesmo modelo, desde que possuam CPF brasileiro inscrito. |

### 2.2. Vendedor Pessoa Jurídica

#### 2.2.1. Certidão Conjunta de Débitos Relativos a Tributos Federais e à Dívida Ativa da União

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Conjunta Negativa de Débitos Relativos a Tributos Federais e à Dívida Ativa da União (CND Federal Conjunta — PGFN/RFB). |
| **Órgão expedidor** | Receita Federal do Brasil (RFB) e Procuradoria-Geral da Fazenda Nacional (PGFN). |
| **Link / Portal** | https://servicos.receitafederal.gov.br/servico/certidoes |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 180 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de controle. |
| **Classificações possíveis** | Negativa, positiva com efeito de negativa, ou positiva. A certidão é válida para a matriz e todas as filiais da empresa. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A regra do art. 16 da Portaria Conjunta PGFN/RFB nº 2/2005 dispensa a apresentação dessa certidão quando o vendedor é pessoa jurídica que explora exclusivamente compra e venda de imóveis, locação, desmembramento ou loteamento, incorporação ou construção, e o imóvel objeto da transação está lançado no ativo circulante e nunca constou do ativo permanente. Nessa hipótese, o sistema deve aceitar declaração formal da pessoa jurídica alienante substituindo a certidão. Se positiva pura, bloquear a minuta. Se indisponível por motivo técnico ou cadastral, aceitar declaração de inexistência de passivo fiscal capaz de gerar insolvência, com os adequados reforços contratuais. |

#### 2.2.2. Certidão Negativa de Débitos Trabalhistas

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Trabalhistas (CNDT). |
| **Órgão expedidor** | Tribunal Superior do Trabalho (TST). |
| **Link / Portal** | https://cndt-certidao.tst.jus.br |
| **Prazo de emissão** | Imediato. |
| **Validade** | 180 dias. |
| **Formato de saída** | Arquivo PDF, com autenticação verificável no portal do TST. |
| **Classificações possíveis** | Negativa, positiva ou positiva com efeito de negativa. A certidão atesta a empresa em relação a todos os seus estabelecimentos, agências e filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Para PJ, apontamentos trabalhistas têm relevância elevada por gerar risco de desconsideração da personalidade jurídica e responsabilização patrimonial dos sócios. Se positiva, exigir esclarecimentos sobre o estado da execução e eventual existência de garantia ou penhora. |

#### 2.2.3. Certidão Negativa da Justiça Federal

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Justiça Federal. |
| **Órgão expedidor** | Tribunais Regionais Federais (TRF1 a TRF6), via Sistema de Certidão Unificada do CJF. |
| **Link / Portal** | https://certidao-unificada.cjf.jus.br |
| **Prazo de emissão** | Imediato para negativa. De 5 a 10 dias úteis quando há apontamentos a esclarecer. |
| **Validade** | Prática de mercado: 30 dias a contar da emissão para fins de escritura ou CCV. Para financiamento, a abrangência costuma ser de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | Negativa, positiva (com indicação dos processos), ou positiva com efeito de negativa. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve ser emitida em nome da pessoa jurídica e abranger a seção judiciária da sede da empresa e a da localização do imóvel, quando distintas. Atentar para execuções fiscais federais e ações coletivas que possam comprometer o patrimônio. |

#### 2.2.4. Certificado de Regularidade do FGTS

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certificado de Regularidade do FGTS (CRF). |
| **Órgão expedidor** | Caixa Econômica Federal (CEF). |
| **Link / Portal** | https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf |
| **Prazo de emissão** | Imediato quando regular. Quando há pendências, a regularização precede a emissão. |
| **Validade** | 30 dias a contar da emissão (orientação institucional da CEF). |
| **Formato de saída** | Arquivo PDF com código de verificação no portal da CEF. |
| **Classificações possíveis** | **Regular**: emite-se o CRF, indicando situação regular junto ao FGTS. **Irregular**: a emissão é negada, com indicação das pendências. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória apenas para PJ. Empresas com CRF irregular não conseguem participar de licitações nem realizar diversas operações. Em transações imobiliárias, a irregularidade não impede juridicamente a venda, mas é forte indicador de risco de execução fiscal sobre o patrimônio. Se irregular, o sistema deve gerar alerta para o corretor avaliar o risco com o comprador. |

#### 2.2.5. Comprovante de Inscrição e de Situação Cadastral no CNPJ

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Comprovante de Inscrição e de Situação Cadastral no CNPJ. |
| **Órgão expedidor** | Receita Federal do Brasil (RFB). |
| **Link / Portal** | https://servicos.receitafederal.gov.br/servico/cnpj |
| **Prazo de emissão** | Imediato. |
| **Validade** | Sem prazo formal. Prática: até 30 dias antes da assinatura. |
| **Formato de saída** | Arquivo PDF, com data e hora da consulta. |
| **Classificações possíveis** | **Ativa**: empresa em situação cadastral regular. **Suspensa, inapta, baixada, ou nula**: situações que impedem ou comprometem a validade dos atos da pessoa jurídica. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória e prévia. Se a situação for diferente de ativa, bloquear a minuta. Empresas inaptas há mais de cinco anos podem ser baixadas de ofício, e a venda por empresa inapta gera nulidade do ato. A base de contratos demonstra o cuidado com este ponto: registros mostram declarações expressas de participações societárias com observação sobre o status cadastral de cada uma. |

### 2.3. Imóvel

#### 2.3.1. Certidão de Inteiro Teor da Matrícula com Negativa de Ônus

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Inteiro Teor da Matrícula, com Negativa de Ônus, Alienações e Ações Reais e Pessoais Reipersecutórias. |
| **Órgão expedidor** | Cartório de Registro de Imóveis (CRI) competente para a circunscrição do imóvel. A certidão pode ser solicitada pela Central Eletrônica do Registro de Imóveis (ONR) com abrangência nacional. |
| **Link / Portal** | https://www.registradores.org.br (Central de Serviços Eletrônicos Compartilhados — ONR). |
| **Prazo de emissão** | Imediato quando o cartório opera em meio digital. Para cartórios não digitalizados ou para certidões com pesquisas manuais complexas, o prazo legal é de até 5 dias úteis (Lei nº 6.015/1973). |
| **Validade** | 30 dias para fins de escritura, financiamento ou registro. Esta é a regra mais consolidada nos contratos da base de conhecimento e é exigida por instituições financeiras e tabelionatos de notas. |
| **Formato de saída** | Arquivo PDF assinado digitalmente pelo registrador, com selo digital do tribunal de justiça do estado do imóvel. |
| **Classificações possíveis** | **Negativa de ônus**: inexistência de hipotecas, penhoras, indisponibilidades, alienações fiduciárias, ações reais ou pessoais reipersecutórias. **Positiva**: existência de qualquer um desses gravames. Pode também conter averbações premonitórias, que indicam a existência de ações em fase pré-executiva. |
| **Regras de negócio (ContractMaker)** | Documento mais crítico de toda a diligência. Sem certidão atualizada e negativa de ônus, o sistema não deve liberar a assinatura do instrumento definitivo. Se houver qualquer ônus, o sistema deve sinalizar e exigir um plano de baixa antes da escritura — quitação de hipoteca, levantamento de penhora, cancelamento de alienação fiduciária. Em operações com financiamento, a matrícula atualizada também é exigida pelo agente financeiro para a engenharia de aprovação. Atentar para o fato de que, mesmo em vendas à vista, o registro do CCV na matrícula confere maior segurança ao comprador. |

#### 2.3.2. Certidão de Regularidade do Imóvel Rural — quando aplicável

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Conjunta Negativa de Débitos relativa a Imóvel Rural (CCIR e ITR). |
| **Órgão expedidor** | Receita Federal do Brasil (ITR) e INCRA (CCIR). |
| **Link / Portal** | https://www.gov.br/incra (CCIR) e https://servicos.receitafederal.gov.br (ITR). |
| **Prazo de emissão** | Imediato quando emitida pela internet. |
| **Validade** | 180 dias para a CND-ITR. O CCIR não tem validade formal, mas é exigida a sua atualização anual. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Negativa, positiva ou positiva com efeito de negativa. O CCIR pode estar regular, em atraso, ou cancelado. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória apenas para imóveis rurais. O sistema deve identificar a natureza do imóvel pela matrícula (rural ou urbano) e ativar esta certidão apenas quando aplicável. Imóveis rurais demandam ainda autorização do INCRA para venda a estrangeiros, conforme limites legais. |

### 2.4. Certidões Nacionais Auxiliares

#### 2.4.1. Certidão de Protesto Nacional — CENPROT

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Protesto de Títulos. |
| **Órgão expedidor** | Instituto de Estudos de Protesto de Títulos do Brasil (IEPTB), por meio da Central Nacional de Serviços Eletrônicos dos Tabeliães de Protesto (CENPROT Nacional). |
| **Link / Portal** | https://www.pesquisaprotesto.com.br (consulta gratuita) e https://www.cenprotnacional.org.br (certidão oficial). |
| **Prazo de emissão** | De 1 a 5 dias úteis, conforme o cartório de cada município. A consulta gratuita é imediata e indica apenas a existência ou não de protestos, sem força de certidão. |
| **Validade** | Prática de mercado: 30 dias para fins de escritura. A abrangência padrão é de 5 anos; para operações com financiamento, costuma-se solicitar 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente pelo tabelião. |
| **Classificações possíveis** | **Negativa**: inexistência de protestos no período pesquisado. **Positiva**: existência de protestos, com indicação do credor, valor e tabelionato. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para Vendedor PF e PJ. Para Imóvel, não há certidão de protesto vinculada à matrícula. Se positiva, o sistema deve permitir avaliação caso a caso pelo corretor: protestos antigos sem ações executivas conexas podem não impedir a operação, mas devem ser informados ao comprador. A base de contratos demonstra o uso recorrente da Consulta CENPROT como filtro inicial de risco patrimonial. |

#### 2.4.2. Consulta ao Cadastro Nacional de Indisponibilidade de Bens — CNIB

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão da Central Nacional de Indisponibilidade de Bens (CNIB). |
| **Órgão expedidor** | Instituto de Registro Imobiliário do Brasil (IRIB), sob fiscalização do CNJ. |
| **Link / Portal** | https://www.indisponibilidade.org.br |
| **Prazo de emissão** | Imediato. |
| **Validade** | 30 dias para fins de escritura. |
| **Formato de saída** | Arquivo PDF, com autenticação no portal do IRIB. |
| **Classificações possíveis** | **Negativa**: nenhuma ordem de indisponibilidade vigente em nome do pesquisado. **Positiva**: existência de ordem judicial ou administrativa de indisponibilidade. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para Vendedor PF e PJ. Indisponibilidade é causa direta de impossibilidade jurídica de alienação. Se positiva, bloquear minuta sem exceções. A indisponibilidade pode ser parcial (apenas alguns bens) ou total — em ambos os casos, a transação não pode prosseguir sem ordem judicial de levantamento. |

---
## 3. São Paulo (SP) — Capital: São Paulo

São Paulo é o estado com o maior volume de transações imobiliárias do país e o mais relevante para o negócio. As particularidades locais incluem a coexistência dos sistemas SAJ SGC e eproc no TJSP, a estrutura de tributos mobiliários e imobiliários da Prefeitura de São Paulo, e a integração da SEFAZ-SP com a PGE-SP para emissão de certidões de dívida ativa.

### 3.1. Justiça Estadual — Tribunal de Justiça de SP

O Tribunal de Justiça de São Paulo disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 3.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de São Paulo (TJSP), 1ª instância. |
| **Link / Portal** | https://esaj.tjsp.jus.br/esaj?servico=810000 |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. Atenção especial: a partir de 31 de março de 2025, a Certidão de Distribuição Cível em Geral do sistema SAJ SGC deve ser complementada pela certidão do sistema eproc (Comunicado CG nº 277/2024). A partir de 5 de novembro de 2025, a Certidão de Falências, Concordatas e Recuperações também passou a exigir a complementação eproc. O ContractMaker deve emitir as duas certidões em sequência sempre que se tratar do TJSP. |

#### 3.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de São Paulo (TJSP), 1ª instância. |
| **Link / Portal** | https://esaj.tjsp.jus.br/esaj?servico=810000 |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 3.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de São Paulo (TJSP), 1ª instância. |
| **Link / Portal** | https://esaj.tjsp.jus.br/esaj?servico=810000 |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 3.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de São Paulo (TJSP), 1ª instância. |
| **Link / Portal** | https://esaj.tjsp.jus.br/esaj?servico=810000 |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 3.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 2ª Região (TRT2 — Capital e Grande São Paulo) e Tribunal Regional do Trabalho da 15ª Região (TRT15 — Interior). |
| **Link / Portal** | https://ww2.trt2.jus.br e https://trt15.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 3.2. Fazenda Estadual — Secretaria da Fazenda de SP

A Secretaria da Fazenda de São Paulo emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 3.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de São Paulo (SEFAZSP). |
| **Link / Portal** | https://www4.fazenda.sp.gov.br/CertidaoNegativaDebitos |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 180 dias para a Certidão de Débitos Tributários Não Inscritos (SEFAZ). 180 dias para a Certidão de Débitos Inscritos em Dívida Ativa (PGE-SP). |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em São Paulo, a certidão é dividida entre Débitos Não Inscritos (emitida pela SEFAZ-SP) e Débitos Inscritos em Dívida Ativa (emitida pela PGE-SP). A base de contratos demonstra que ambas são solicitadas separadamente em transações relevantes na capital. |

#### 3.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de São Paulo (SEFAZSP). |
| **Link / Portal** | https://www4.fazenda.sp.gov.br/CertidaoNegativaDebitos |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 180 dias para a Certidão de Débitos Tributários Não Inscritos (SEFAZ). 180 dias para a Certidão de Débitos Inscritos em Dívida Ativa (PGE-SP). |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

#### 3.2.3. Certidão Negativa de Débitos Inscritos em Dívida Ativa Estadual

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Regularidade da Dívida Ativa do Estado de São Paulo (e-CRDA). |
| **Órgão expedidor** | Procuradoria-Geral do Estado de São Paulo (PGE-SP). |
| **Link / Portal** | https://www.dividaativa.pge.sp.gov.br/sc/pages/crda/emitirCrda.jsf |
| **Prazo de emissão** | Imediato quando emitida pela internet sem pendências. |
| **Validade** | 180 dias. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória, complementar à certidão da SEFAZ. A PGE-SP emite a Certidão Positiva com Efeito de Negativa via processo SEI quando há débito garantido ou suspenso (e-mail: pge-cepenfiscal@sp.gov.br). A separação entre SEFAZ e PGE em São Paulo é uma particularidade que o sistema deve tratar como duas chamadas distintas. |

### 3.3. Justiça Federal — Tribunal Regional Federal da 3ª Região (TRF3) — abrange São Paulo e Mato Grosso do Sul.

A Justiça Federal em São Paulo é uma das mais movimentadas do país. Para imóveis na capital paulista, a seção judiciária aplicável é a do estado de São Paulo. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 3.3.1. Certidão Cível e Criminal da Seção Judiciária de São Paulo

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de São Paulo. |
| **Órgão expedidor** | Tribunal Regional Federal da 3ª Região (TRF3) — abrange São Paulo e Mato Grosso do Sul. |
| **Link / Portal** | https://web.trf3.jus.br/certidao-regional/CertidaoCivelEleitoralCriminal |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 3.4. Município de São Paulo

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de São Paulo. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 3.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Conjunta de Débitos de Tributos Imobiliários (IPTU, TFE e demais). |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de São Paulo. |
| **Link / Portal** | https://prefeitura.sp.gov.br/web/fazenda/w/servicos/certidoes/2407 |
| **Prazo de emissão** | Imediato quando emitida pela internet sem débitos. Quando há débitos pendentes, a Solicitação de Análise de Certidão Imobiliária via processo SEI tem prazo de até 10 dias. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em São Paulo, o imóvel é identificado pelo número de contribuinte SQL (Setor, Quadra, Lote). A certidão não abrange as Taxas de Lixo (TRSD e TRSS), nem o ITBI — para estes, exigir documentos complementares. Para vendedores sem imóvel cadastrado em SP, existe a Certidão de Rol Nominal, que comprova ausência de cadastro. |

#### 3.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de São Paulo. |
| **Link / Portal** | https://prefeitura.sp.gov.br/web/fazenda/w/servicos/certidoes/2407 |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 3.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em São Paulo (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

### 3.5. Observações específicas para São Paulo

São Paulo Capital também emite, via DUC (Demonstrativo Unificado do Contribuinte), as certidões de Tributos Mobiliários e ISS. A Junta Comercial de São Paulo (JUCESP) emite a Certidão Simplificada eletrônica para verificar a regularidade societária e, especialmente, para identificar se uma pessoa física compõe quadro societário de empresa não declarada — diligência presente em diversos contratos da base. A Consulta CENPROT-SP (https://protestosp.com.br) é o canal oficial para certidão de protesto no estado.

---

## 4. Rio Grande do Sul (RS) — Capital: Porto Alegre

O Rio Grande do Sul opera com sistema eproc para a maioria dos processos digitais e mantém regras específicas de obrigatoriedade de emissão eletrônica na comarca da capital. A integração entre TJRS, TRT4 e Receita Estadual segue padrão consolidado.

### 4.1. Justiça Estadual — Tribunal de Justiça de RS

O Tribunal de Justiça de Rio Grande do Sul disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 4.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Rio Grande do Sul (TJRS), 1ª instância. |
| **Link / Portal** | https://www.tjrs.jus.br/novo/processos-e-servicos/servicos-processuais/emissao-de-antecedentes-e-certidoes |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. Em Porto Alegre, a emissão eletrônica é obrigatória, salvo em casos de comprovada hipossuficiência ou homonímia (Ordem de Serviço 21/2014-DF). Nas comarcas do interior, a emissão eletrônica é facultativa. |

#### 4.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Rio Grande do Sul (TJRS), 1ª instância. |
| **Link / Portal** | https://www.tjrs.jus.br/novo/processos-e-servicos/servicos-processuais/emissao-de-antecedentes-e-certidoes |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 4.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Rio Grande do Sul (TJRS), 1ª instância. |
| **Link / Portal** | https://www.tjrs.jus.br/novo/processos-e-servicos/servicos-processuais/emissao-de-antecedentes-e-certidoes |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 4.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Rio Grande do Sul (TJRS), 1ª instância. |
| **Link / Portal** | https://www.tjrs.jus.br/novo/processos-e-servicos/servicos-processuais/emissao-de-antecedentes-e-certidoes |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 4.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 4ª Região (TRT4) — Rio Grande do Sul. |
| **Link / Portal** | https://www.trt4.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 4.2. Fazenda Estadual — Secretaria da Fazenda de RS

A Secretaria da Fazenda de Rio Grande do Sul emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 4.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Rio Grande do Sul (SEFAZRS). |
| **Link / Portal** | https://www.sefaz.rs.gov.br/Receita/CertidaoSituacaoFiscal |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 90 dias para a Certidão de Situação Fiscal junto à Receita Estadual do RS. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. No RS, a Receita Estadual emite a Certidão de Situação Fiscal, que abrange tanto débitos não inscritos quanto inscritos em dívida ativa, em modelo unificado. A base de contratos faz referência expressa ao 'Relatório de Situação Fiscal' como complemento. |

#### 4.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Rio Grande do Sul (SEFAZRS). |
| **Link / Portal** | https://www.sefaz.rs.gov.br/Receita/CertidaoSituacaoFiscal |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 90 dias para a Certidão de Situação Fiscal junto à Receita Estadual do RS. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

### 4.3. Justiça Federal — Tribunal Regional Federal da 4ª Região (TRF4) — abrange Rio Grande do Sul, Santa Catarina e Paraná.

O TRF4 atende três dos estados deste documento (RS, SC, PR), com sistema próprio e bem consolidado. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 4.3.1. Certidão Cível e Criminal da Seção Judiciária de Rio Grande do Sul

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Rio Grande do Sul. |
| **Órgão expedidor** | Tribunal Regional Federal da 4ª Região (TRF4) — abrange Rio Grande do Sul, Santa Catarina e Paraná. |
| **Link / Portal** | https://www2.trf4.jus.br/trf4/processos/certidao/index.php |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 4.4. Município de Porto Alegre

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Porto Alegre. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 4.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Imobiliários (IPTU e Taxas). |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Porto Alegre. |
| **Link / Portal** | https://prefeitura.poa.br/secretarias/secretaria-municipal-da-fazenda |
| **Prazo de emissão** | Imediato quando o imóvel está regular. Quando há débitos inscritos ou pendências, prazo de até 10 dias para análise. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em Porto Alegre, a certidão imobiliária é vinculada ao cadastro do imóvel na Secretaria Municipal da Fazenda. Atentar para a possibilidade de débitos de Contribuição de Melhoria, de aplicação corrente em obras viárias da capital. |

#### 4.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Porto Alegre. |
| **Link / Portal** | https://prefeitura.poa.br/secretarias/secretaria-municipal-da-fazenda |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 4.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Porto Alegre (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

---

## 5. Rio de Janeiro (RJ) — Capital: Rio de Janeiro

O Rio de Janeiro tem particularidades importantes: a estrutura dos Ofícios de Registro de Distribuição privatizados na capital (1º, 2º e demais ofícios), a emissão pela Corregedoria Geral da Justiça via Portal Extrajudicial, e a relevância das certidões de Foro e Laudêmio para imóveis foreiros — situação comum em áreas centrais e na orla.

### 5.1. Justiça Estadual — Tribunal de Justiça de RJ

O Tribunal de Justiça de Rio de Janeiro disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 5.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Rio de Janeiro (TJRJ), 1ª instância. |
| **Link / Portal** | https://www4.tjrj.jus.br/Portal-Extrajudicial/certidao |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. Na cidade do Rio de Janeiro, as certidões cíveis e criminais são emitidas pelos Ofícios de Registro de Distribuição privatizados (notadamente o 2º Ofício do Registro de Distribuição), e não pelos serviços oficializados como nas demais comarcas do estado. Os contratos da base mostram o uso recorrente do '2º Ofício do Registro de Distribuição de Feitos Ajuizados' e do '2º Ofício do Registro de Distribuição Fiscal e Fazendária'. |

#### 5.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Rio de Janeiro (TJRJ), 1ª instância. |
| **Link / Portal** | https://www4.tjrj.jus.br/Portal-Extrajudicial/certidao |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 5.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Rio de Janeiro (TJRJ), 1ª instância. |
| **Link / Portal** | https://www4.tjrj.jus.br/Portal-Extrajudicial/certidao |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 5.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Rio de Janeiro (TJRJ), 1ª instância. |
| **Link / Portal** | https://www4.tjrj.jus.br/Portal-Extrajudicial/certidao |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 5.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 1ª Região (TRT1) — Rio de Janeiro. |
| **Link / Portal** | https://www.trt1.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 5.2. Fazenda Estadual — Secretaria da Fazenda de RJ

A Secretaria da Fazenda de Rio de Janeiro emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 5.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Rio de Janeiro (SEFAZRJ). |
| **Link / Portal** | https://www.consultadividaativa.rj.gov.br |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 180 dias para a Certidão de Regularidade Fiscal do Estado do Rio de Janeiro (Resolução PGE 5002/2023). |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. No RJ, a Certidão de Regularidade Fiscal da SEFAZ refere-se apenas aos débitos não inscritos. Os débitos inscritos em dívida ativa demandam a Certidão de Regularidade Fiscal da Dívida Ativa, emitida pela PGE-RJ (Resolução Conjunta PGE/SER 33/2004). Em geral, exige-se a apresentação das duas. |

#### 5.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Rio de Janeiro (SEFAZRJ). |
| **Link / Portal** | https://www.consultadividaativa.rj.gov.br |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 180 dias para a Certidão de Regularidade Fiscal do Estado do Rio de Janeiro (Resolução PGE 5002/2023). |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

#### 5.2.3. Certidão Negativa de Débitos Inscritos em Dívida Ativa Estadual

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Regularidade Fiscal da Dívida Ativa do Estado do Rio de Janeiro. |
| **Órgão expedidor** | Procuradoria-Geral do Estado do Rio de Janeiro (PGE-RJ). |
| **Link / Portal** | https://www.dividaativa.rj.gov.br |
| **Prazo de emissão** | Imediato quando emitida pela internet sem pendências. |
| **Validade** | 180 dias contados da emissão (art. 17, Resolução PGE 5002/2023). |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A PGE-RJ permite o requerimento de nova certidão a partir do trigésimo dia anterior ao vencimento da vigente, recurso útil para o ContractMaker programar renovações automáticas. |

### 5.3. Justiça Federal — Tribunal Regional Federal da 2ª Região (TRF2) — abrange Rio de Janeiro e Espírito Santo.

O TRF2 atende RJ e ES, com sistema unificado. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 5.3.1. Certidão Cível e Criminal da Seção Judiciária de Rio de Janeiro

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Rio de Janeiro. |
| **Órgão expedidor** | Tribunal Regional Federal da 2ª Região (TRF2) — abrange Rio de Janeiro e Espírito Santo. |
| **Link / Portal** | https://www10.trf2.jus.br/portal/servicos/certidoes |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 5.4. Município de Rio de Janeiro

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Rio de Janeiro. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 5.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos de IPTU e Taxas. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Rio de Janeiro. |
| **Link / Portal** | https://carioca.rio/servicos/certidao-negativa-iptu |
| **Prazo de emissão** | Imediato via internet quando o imóvel está regular. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em transações no Rio de Janeiro, atentar especialmente para imóveis foreiros (terrenos da União, da Marinha ou do Patrimônio Imperial), que demandam certidões adicionais de Foro e Laudêmio. A base de contratos demonstra a inclusão expressa de Foro e Laudêmio (em caso de imóvel foreiro) e Taxa de Incêndio entre as obrigações dos vendedores no Rio de Janeiro. |

#### 5.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Rio de Janeiro. |
| **Link / Portal** | https://carioca.rio/servicos/certidao-negativa-iptu |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 5.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Rio de Janeiro (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

### 5.5. Observações específicas para Rio de Janeiro

Particularidades cariocas relevantes: a Taxa de Incêndio (CBMERJ), a verificação de Foro e Laudêmio para imóveis foreiros (consulta à SPU e ao Patrimônio Imperial), e a necessidade do '1º e 2º Ofícios de Interdições e Tutelas' para verificação da capacidade civil do vendedor — diligência expressamente presente nos contratos da base aplicáveis ao Rio de Janeiro.

---

## 6. Paraná (PR) — Capital: Curitiba

O Paraná opera com sistema PROJUDI para a 1ª instância e tem corregedoria-geral da justiça centralizada. As certidões judiciais devem ser solicitadas no Ofício Distribuidor da comarca de residência do interessado.

### 6.1. Justiça Estadual — Tribunal de Justiça de PR

O Tribunal de Justiça de Paraná disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 6.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Paraná (TJPR), 1ª instância. |
| **Link / Portal** | https://portal.tjpr.jus.br/portletforms/publico/frm.do?idFormulario=4667 |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. No PR, as certidões de 1º grau podem ser cíveis ou criminais, para PF ou PJ, e são vinculadas às comarcas. Para fins de licitação e finalidades comerciais, há modelo específico emitido pela Corregedoria-Geral da Justiça. |

#### 6.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Paraná (TJPR), 1ª instância. |
| **Link / Portal** | https://portal.tjpr.jus.br/portletforms/publico/frm.do?idFormulario=4667 |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 6.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Paraná (TJPR), 1ª instância. |
| **Link / Portal** | https://portal.tjpr.jus.br/portletforms/publico/frm.do?idFormulario=4667 |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 6.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Paraná (TJPR), 1ª instância. |
| **Link / Portal** | https://portal.tjpr.jus.br/portletforms/publico/frm.do?idFormulario=4667 |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 6.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 9ª Região (TRT9) — Paraná. |
| **Link / Portal** | https://www.trt9.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 6.2. Fazenda Estadual — Secretaria da Fazenda de PR

A Secretaria da Fazenda de Paraná emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 6.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Paraná (SEFAZPR). |
| **Link / Portal** | https://www.fazenda.pr.gov.br/Pagina/Emissao-de-Certidao-Negativa-de-Debitos-Tributarios-e-de-Divida-Ativa-Estadual |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 60 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. No PR, a SEFAZ-PR emite Certidão Negativa de Débitos Tributários e de Dívida Ativa Estadual em modelo único, abrangendo débitos junto à fazenda e à PGE. |

#### 6.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Paraná (SEFAZPR). |
| **Link / Portal** | https://www.fazenda.pr.gov.br/Pagina/Emissao-de-Certidao-Negativa-de-Debitos-Tributarios-e-de-Divida-Ativa-Estadual |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 60 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

### 6.3. Justiça Federal — Tribunal Regional Federal da 4ª Região (TRF4) — abrange Paraná, Santa Catarina e Rio Grande do Sul.

Mesma região do RS e SC, com portal único. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 6.3.1. Certidão Cível e Criminal da Seção Judiciária de Paraná

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Paraná. |
| **Órgão expedidor** | Tribunal Regional Federal da 4ª Região (TRF4) — abrange Paraná, Santa Catarina e Rio Grande do Sul. |
| **Link / Portal** | https://www2.trf4.jus.br/trf4/processos/certidao/index.php |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 6.4. Município de Curitiba

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Curitiba. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 6.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos do IPTU. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Curitiba. |
| **Link / Portal** | https://www.curitiba.pr.gov.br/servicos/empresas/certidao-negativa-de-debitos/166 |
| **Prazo de emissão** | Imediato via internet quando o imóvel está regular. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em Curitiba, o sistema da Prefeitura permite emissão online via certificação digital ou senha web. Atentar para Contribuição de Melhoria em áreas com obras recentes. |

#### 6.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Curitiba. |
| **Link / Portal** | https://www.curitiba.pr.gov.br/servicos/empresas/certidao-negativa-de-debitos/166 |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 6.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Curitiba (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

---

## 7. Santa Catarina (SC) — Capital: Florianópolis

Santa Catarina migrou completamente para o sistema eproc em 2023, com sistema de emissão de certidões totalmente digital. A SEFAZ-SC tem operação consolidada e integração com PGE.

### 7.1. Justiça Estadual — Tribunal de Justiça de SC

O Tribunal de Justiça de Santa Catarina disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 7.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Santa Catarina (TJSC), 1ª instância. |
| **Link / Portal** | https://www.tjsc.jus.br/web/judicial/certidoes |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. Em SC, a Certidão Cível em Geral abrange todas as classes cíveis, exceto cartas precatórias, e inclui ações nos Juizados Especiais Cíveis, Juizados Fazendários, Turmas Recursais, Execuções Fiscais e Justiça Militar. As certidões anteriores a 27/03/2023 estão em sistema legado separado. |

#### 7.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Santa Catarina (TJSC), 1ª instância. |
| **Link / Portal** | https://www.tjsc.jus.br/web/judicial/certidoes |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 7.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Santa Catarina (TJSC), 1ª instância. |
| **Link / Portal** | https://www.tjsc.jus.br/web/judicial/certidoes |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 7.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Santa Catarina (TJSC), 1ª instância. |
| **Link / Portal** | https://www.tjsc.jus.br/web/judicial/certidoes |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 7.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 12ª Região (TRT12) — Santa Catarina. |
| **Link / Portal** | https://www.trt12.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 7.2. Fazenda Estadual — Secretaria da Fazenda de SC

A Secretaria da Fazenda de Santa Catarina emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 7.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Santa Catarina (SEFAZSC). |
| **Link / Portal** | https://sat.sef.sc.gov.br/tax.NET/Sat.CCC.Web/CCC11500_EmitirCertidaoTributaria.aspx |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 90 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em SC, a Certidão Negativa de Débitos Tributários é emitida pela SEFAZ-SC e abrange ICMS, IPVA, ITCMD e demais tributos estaduais. |

#### 7.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Santa Catarina (SEFAZSC). |
| **Link / Portal** | https://sat.sef.sc.gov.br/tax.NET/Sat.CCC.Web/CCC11500_EmitirCertidaoTributaria.aspx |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 90 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

### 7.3. Justiça Federal — Tribunal Regional Federal da 4ª Região (TRF4) — abrange Santa Catarina, Paraná e Rio Grande do Sul.

Mesma região do RS e PR. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 7.3.1. Certidão Cível e Criminal da Seção Judiciária de Santa Catarina

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Santa Catarina. |
| **Órgão expedidor** | Tribunal Regional Federal da 4ª Região (TRF4) — abrange Santa Catarina, Paraná e Rio Grande do Sul. |
| **Link / Portal** | https://www2.trf4.jus.br/trf4/processos/certidao/index.php |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 7.4. Município de Florianópolis

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Florianópolis. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 7.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Imobiliários (IPTU e taxas). |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Florianópolis. |
| **Link / Portal** | https://www.pmf.sc.gov.br/servicos/index.php?pagina=servpagina&id=4929 |
| **Prazo de emissão** | Imediato quando emitida pela internet sem débitos. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em Florianópolis, a Certidão Negativa de Débitos Imobiliários é emitida pela Secretaria Municipal da Fazenda. Atentar para situações específicas de imóveis em áreas litorâneas e em terrenos de marinha (que envolvem laudêmio e foro junto à SPU). |

#### 7.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Florianópolis. |
| **Link / Portal** | https://www.pmf.sc.gov.br/servicos/index.php?pagina=servpagina&id=4929 |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 7.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Florianópolis (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

---

## 8. Minas Gerais (MG) — Capital: Belo Horizonte

Minas Gerais utiliza o sistema RUPE (Registro Único de Processo Eletrônico) para a primeira instância e tem TRF próprio (TRF6, criado em 2022). A Prefeitura de Belo Horizonte tem sistemas avançados de emissão eletrônica.

### 8.1. Justiça Estadual — Tribunal de Justiça de MG

O Tribunal de Justiça de Minas Gerais disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 8.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Minas Gerais (TJMG), 1ª instância. |
| **Link / Portal** | https://www.tjmg.jus.br/portal-tjmg/processos/certidao-judicial |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. No TJMG, a emissão é gratuita pela internet. Quando não é possível a emissão imediata, a solicitação é atendida em 48 horas. As certidões de 1ª instância incluem cível, criminal, vintenárias, insolvência, execução cível, tutela e curatela, falência e concordata. |

#### 8.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Minas Gerais (TJMG), 1ª instância. |
| **Link / Portal** | https://www.tjmg.jus.br/portal-tjmg/processos/certidao-judicial |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 8.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Minas Gerais (TJMG), 1ª instância. |
| **Link / Portal** | https://www.tjmg.jus.br/portal-tjmg/processos/certidao-judicial |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 8.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Minas Gerais (TJMG), 1ª instância. |
| **Link / Portal** | https://www.tjmg.jus.br/portal-tjmg/processos/certidao-judicial |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 8.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 3ª Região (TRT3) — Minas Gerais. |
| **Link / Portal** | https://portal.trt3.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 8.2. Fazenda Estadual — Secretaria da Fazenda de MG

A Secretaria da Fazenda de Minas Gerais emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 8.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Minas Gerais (SEFAZMG). |
| **Link / Portal** | https://www2.fazenda.mg.gov.br/sol/ctrl/SOL/CERTIDAO_DEBITO/SCE_2102 |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 90 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A SEFAZ-MG emite a Certidão de Débitos Tributários, em modelo unificado para débitos não inscritos e inscritos em dívida ativa. |

#### 8.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Minas Gerais (SEFAZMG). |
| **Link / Portal** | https://www2.fazenda.mg.gov.br/sol/ctrl/SOL/CERTIDAO_DEBITO/SCE_2102 |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 90 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

### 8.3. Justiça Federal — Tribunal Regional Federal da 6ª Região (TRF6) — abrange exclusivamente Minas Gerais.

O TRF6 foi criado em 2022 para descentralizar a Justiça Federal mineira, antes vinculada ao TRF1. É um tribunal recente, com sistemas próprios consolidados. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 8.3.1. Certidão Cível e Criminal da Seção Judiciária de Minas Gerais

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Minas Gerais. |
| **Órgão expedidor** | Tribunal Regional Federal da 6ª Região (TRF6) — abrange exclusivamente Minas Gerais. |
| **Link / Portal** | https://sistemas.trf6.jus.br/certidao |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 8.4. Município de Belo Horizonte

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Belo Horizonte. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 8.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos do IPTU. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Belo Horizonte. |
| **Link / Portal** | https://prefeitura.pbh.gov.br/fazenda/iptu |
| **Prazo de emissão** | Imediato via internet quando o imóvel está regular. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em Belo Horizonte, o imóvel é identificado pelo Índice Cadastral. A Prefeitura emite Certidão Negativa de IPTU, Certidão Tributária Imobiliária por Exercício, e Certidão Negativa de Índice Cadastral. Atentar para o ITBI mineiro, com regras específicas pós-decisão do TJMG sobre alíquotas (Lei 10.692/2013). |

#### 8.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Belo Horizonte. |
| **Link / Portal** | https://prefeitura.pbh.gov.br/fazenda/iptu |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 8.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Belo Horizonte (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

---

## 9. Espírito Santo (ES) — Capital: Vitória

O Espírito Santo opera com TJES e TRT17, ambos com portais consolidados de emissão eletrônica. A SEFAZ-ES integra a Receita Estadual e a Procuradoria.

### 9.1. Justiça Estadual — Tribunal de Justiça de ES

O Tribunal de Justiça de Espírito Santo disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 9.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Espírito Santo (TJES), 1ª instância. |
| **Link / Portal** | https://sistemas.tjes.jus.br/certidaonegativa/sistemas/certidao/CERTIDAOPESQUISA.cfm |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. No TJES, a emissão é gratuita e online, com validação no portal do tribunal. |

#### 9.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Espírito Santo (TJES), 1ª instância. |
| **Link / Portal** | https://sistemas.tjes.jus.br/certidaonegativa/sistemas/certidao/CERTIDAOPESQUISA.cfm |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 9.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Espírito Santo (TJES), 1ª instância. |
| **Link / Portal** | https://sistemas.tjes.jus.br/certidaonegativa/sistemas/certidao/CERTIDAOPESQUISA.cfm |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 9.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Espírito Santo (TJES), 1ª instância. |
| **Link / Portal** | https://sistemas.tjes.jus.br/certidaonegativa/sistemas/certidao/CERTIDAOPESQUISA.cfm |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 9.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 17ª Região (TRT17) — Espírito Santo. |
| **Link / Portal** | https://www.trt17.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 9.2. Fazenda Estadual — Secretaria da Fazenda de ES

A Secretaria da Fazenda de Espírito Santo emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 9.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Espírito Santo (SEFAZES). |
| **Link / Portal** | https://internet.sefaz.es.gov.br/agenciavirtual/area_publica/e-cnd/cnd.php |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 90 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A SEFAZ-ES emite Certidão Negativa de Débitos para com a Fazenda Pública Estadual em modelo unificado. |

#### 9.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Espírito Santo (SEFAZES). |
| **Link / Portal** | https://internet.sefaz.es.gov.br/agenciavirtual/area_publica/e-cnd/cnd.php |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 90 dias contados da emissão. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

### 9.3. Justiça Federal — Tribunal Regional Federal da 2ª Região (TRF2) — abrange Espírito Santo e Rio de Janeiro.

Mesmo TRF do Rio de Janeiro. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 9.3.1. Certidão Cível e Criminal da Seção Judiciária de Espírito Santo

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Espírito Santo. |
| **Órgão expedidor** | Tribunal Regional Federal da 2ª Região (TRF2) — abrange Espírito Santo e Rio de Janeiro. |
| **Link / Portal** | https://www10.trf2.jus.br/portal/servicos/certidoes |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 9.4. Município de Vitória

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Vitória. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 9.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Vitória. |
| **Link / Portal** | https://servicos.vitoria.es.gov.br/servicosweb/Servico/3/Certidao_Negativa_de_Debitos |
| **Prazo de emissão** | Imediato via internet quando o imóvel está regular. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em Vitória, a Certidão Negativa de Débitos cobre tributos imobiliários e mobiliários da Prefeitura. |

#### 9.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Vitória. |
| **Link / Portal** | https://servicos.vitoria.es.gov.br/servicosweb/Servico/3/Certidao_Negativa_de_Debitos |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 9.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Vitória (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

---

## 10. Mato Grosso (MT) — Capital: Cuiabá

O Mato Grosso tem atuação consolidada do TJMT e TRT23, com sistemas eletrônicos próprios. A relevância de imóveis rurais no estado demanda atenção adicional aos cuidados específicos do INCRA, ITR e CCIR.

### 10.1. Justiça Estadual — Tribunal de Justiça de MT

O Tribunal de Justiça de Mato Grosso disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 10.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso (TJMT), 1ª instância. |
| **Link / Portal** | https://sec.tjmt.jus.br/emitir-certidao-de-primeiro-grau |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. O TJMT emite certidões pelo sistema SEC (Sistema de Emissão de Certidões), com validação no portal do tribunal. |

#### 10.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso (TJMT), 1ª instância. |
| **Link / Portal** | https://sec.tjmt.jus.br/emitir-certidao-de-primeiro-grau |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 10.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso (TJMT), 1ª instância. |
| **Link / Portal** | https://sec.tjmt.jus.br/emitir-certidao-de-primeiro-grau |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 10.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso (TJMT), 1ª instância. |
| **Link / Portal** | https://sec.tjmt.jus.br/emitir-certidao-de-primeiro-grau |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 10.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 23ª Região (TRT23) — Mato Grosso. |
| **Link / Portal** | https://portal.trt23.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 10.2. Fazenda Estadual — Secretaria da Fazenda de MT

A Secretaria da Fazenda de Mato Grosso emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 10.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Mato Grosso (SEFAZMT). |
| **Link / Portal** | https://www5.sefaz.mt.gov.br |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 60 dias para a Certidão Negativa de Débitos. 90 dias para entes públicos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A Certidão Conjunta de Pendências Tributárias e Não Tributárias da SEFAZ e PGE-MT é emitida em modelo unificado, abrangendo débitos administrados pela Receita Estadual e os inscritos em dívida ativa pela PGE-MT. |

#### 10.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Mato Grosso (SEFAZMT). |
| **Link / Portal** | https://www5.sefaz.mt.gov.br |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 60 dias para a Certidão Negativa de Débitos. 90 dias para entes públicos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

#### 10.2.3. Certidão Negativa de Débitos Inscritos em Dívida Ativa Estadual

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Conjunta de Pendências Tributárias e Não Tributárias junto à SEFAZ e à PGE-MT. |
| **Órgão expedidor** | Procuradoria-Geral do Estado de Mato Grosso (PGE-MT) e SEFAZ-MT, em emissão conjunta. |
| **Link / Portal** | https://www.pge.mt.gov.br/en/emitir-certid%C3%A3o-negativa-de-d%C3%A9bitos |
| **Prazo de emissão** | Imediato quando emitida pela internet sem pendências. |
| **Validade** | 60 dias. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A emissão conjunta é uma vantagem operacional do MT — basta uma chamada para verificar a regularidade tributária estadual completa. |

### 10.3. Justiça Federal — Tribunal Regional Federal da 1ª Região (TRF1) — abrange Mato Grosso e diversos outros estados.

O TRF1 tem a maior abrangência geográfica do país, atendendo o MT e mais 13 estados e o DF. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 10.3.1. Certidão Cível e Criminal da Seção Judiciária de Mato Grosso

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Mato Grosso. |
| **Órgão expedidor** | Tribunal Regional Federal da 1ª Região (TRF1) — abrange Mato Grosso e diversos outros estados. |
| **Link / Portal** | https://sistemas.trf1.jus.br/certidao |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 10.4. Município de Cuiabá

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Cuiabá. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 10.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Imobiliários. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Cuiabá. |
| **Link / Portal** | https://www.cuiaba.mt.gov.br/servicos/certidao-negativa |
| **Prazo de emissão** | Imediato via internet quando o imóvel está regular. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em Cuiabá, atentar para o cadastro imobiliário municipal e para a regularização fundiária de áreas em expansão urbana, comum no estado. |

#### 10.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Cuiabá. |
| **Link / Portal** | https://www.cuiaba.mt.gov.br/servicos/certidao-negativa |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 10.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Cuiabá (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

### 10.5. Observações específicas para Mato Grosso

Para imóveis rurais em MT, exigência adicional do CCIR atualizado e da Certidão Negativa de Débitos relativa ao ITR. O CAR (Cadastro Ambiental Rural) também é relevante para a regularização ambiental, embora não seja certidão em sentido estrito.

---

## 11. Mato Grosso do Sul (MS) — Capital: Campo Grande

Mato Grosso do Sul utiliza o sistema e-SAJ no TJMS, com emissão eletrônica gratuita. A SEFAZ-MS tem portal e-Fazenda integrado.

### 11.1. Justiça Estadual — Tribunal de Justiça de MS

O Tribunal de Justiça de Mato Grosso do Sul disponibiliza a emissão de certidões judiciais cíveis e criminais por meio de portal eletrônico próprio. As regras a seguir aplicam-se uniformemente aos vendedores PF e PJ, com as particularidades indicadas em cada caso.

#### 11.1.1. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em Geral em nome do vendedor PF. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso do Sul (TJMS), 1ª instância. |
| **Link / Portal** | https://esaj.tjms.jus.br/sco/abrirCadastro.do |
| **Prazo de emissão** | Imediato para certidão negativa quando a comarca está integralmente informatizada. Quando há apontamento ou pesquisa em fichas manuais, prazo de 5 a 10 dias úteis. |
| **Validade** | Prática consolidada na base de contratos: 30 dias da emissão para fins de escritura ou CCV. Para financiamento bancário, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticidade verificável no portal do tribunal. |
| **Classificações possíveis** | **Nada consta**: inexistência de processos cíveis. **Consta**: existência de processos, com listagem dos autos. Pode haver indicação de homônimos não qualificados, que demanda complementação por declaração de homonímia. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A certidão deve abranger ações cíveis em geral, família e sucessões, falências, recuperações judiciais, execuções fiscais e juizados especiais cíveis. Se constar processo, exigir certidão de objeto e pé. Se houver homônimo não qualificado, aceitar declaração de homonímia firmada pelo vendedor. No TJMS, a emissão de certidões cíveis e criminais é gratuita e online, com envio automático para o e-mail do solicitante. Quando não é possível a emissão automática (por exemplo, em casos de homonímia), o pedido pode ser feito por e-mail ao Cartório Distribuidor (cgr-cdistribuidor@tjms.jus.br) ou via WhatsApp (67 98407-0618), com prazo de até 3 dias úteis. |

#### 11.1.2. Certidão Estadual de Distribuição Cível — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Cível em nome da pessoa jurídica vendedora, abrangendo falências, concordatas e recuperações. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso do Sul (TJMS), 1ª instância. |
| **Link / Portal** | https://esaj.tjms.jus.br/sco/abrirCadastro.do |
| **Prazo de emissão** | Imediato para negativa em comarcas digitalizadas. De 5 a 10 dias úteis em outros casos. |
| **Validade** | 30 dias para fins contratuais. Abrangência usual de 10 anos para financiamento. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**, **consta**, ou **positiva com efeito de negativa**. A certidão considera processos da matriz e filiais e pode apontar homônimos com tipos empresariais distintos (LTDA, EIRELI, S/A, MEI). |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Atentar especificamente para apontamentos de falência, recuperação judicial ou extrajudicial — qualquer um deles é causa de bloqueio da minuta até esclarecimento. Para empresas com filiais em outros estados, considerar exigir também certidão das comarcas onde há filial. A base de contratos demonstra preocupação especial com a Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |

#### 11.1.3. Certidão Estadual de Distribuição Criminal — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Estadual de Distribuição Criminal. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso do Sul (TJMS), 1ª instância. |
| **Link / Portal** | https://esaj.tjms.jus.br/sco/abrirCadastro.do |
| **Prazo de emissão** | Imediato para negativa via internet. Para fins judiciais ou eleitorais, exige solicitação presencial e prazo de 5 a 10 dias. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**. Pode apontar homônimos não qualificados. |
| **Regras de negócio (ContractMaker)** | Exigência facultativa para fins puramente civis. Em transações com financiamento ou em casos de alta exigência (imóveis de alto valor, vendedores estrangeiros, espólios), o sistema deve elevar a exigência a obrigatória. Aplicável apenas para PF — pessoas jurídicas não respondem criminalmente em sentido estrito, exceto em crimes ambientais. |

#### 11.1.4. Certidão Negativa de Falência, Concordata e Recuperação Judicial — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Falência, Concordata e Recuperação Judicial e Extrajudicial. |
| **Órgão expedidor** | Tribunal de Justiça de Mato Grosso do Sul (TJMS), 1ª instância. |
| **Link / Portal** | https://esaj.tjms.jus.br/sco/abrirCadastro.do |
| **Prazo de emissão** | Imediato para negativa via internet. Para os casos de pesquisa em fichas manuais (anteriores à informatização), pedido presencial e prazo de até 10 dias. |
| **Validade** | 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta**: empresa não está em processo falimentar nem recuperacional. **Consta**: existência de processo, que deve ser detalhado quanto à fase. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Empresas em recuperação judicial podem alienar imóveis com autorização do juízo recuperacional, mas a operação demanda exame caso a caso. Empresas com falência decretada não podem vender — a alienação cabe à massa falida. Se positiva, bloquear a minuta e encaminhar para análise jurídica especializada. |

#### 11.1.5. Certidão da Justiça do Trabalho — TRT da região

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Distribuição de Ações Trabalhistas (1ª e 2ª instâncias do TRT regional). |
| **Órgão expedidor** | Tribunal Regional do Trabalho da 24ª Região (TRT24) — Mato Grosso do Sul. |
| **Link / Portal** | https://www.trt24.jus.br |
| **Prazo de emissão** | Imediato via internet para certidões negativas. De 5 a 10 dias para certidões com apontamentos. |
| **Validade** | Prática: 30 dias para fins contratuais. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Nada consta** ou **consta**, com indicação dos processos. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Para PF, exigir quando o vendedor for empresário individual, MEI, sócio de empresa, ou quando houver indícios de atividade empresarial. Diferentemente da CNDT (que é nacional e cobre apenas execuções definitivas), esta certidão regional aponta também ações em fase de conhecimento, oferecendo visão mais ampla do passivo trabalhista. |

### 11.2. Fazenda Estadual — Secretaria da Fazenda de MS

A Secretaria da Fazenda de Mato Grosso do Sul emite a Certidão Negativa de Débitos Estaduais relativa a tributos administrados pelo estado, principalmente ICMS, IPVA, ITCMD e taxas estaduais. Em alguns estados, a certidão é conjunta com a Procuradoria-Geral do Estado, abrangendo também os débitos inscritos em dívida ativa.

#### 11.2.1. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Física

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome do vendedor PF). |
| **Órgão expedidor** | Secretaria da Fazenda de Mato Grosso do Sul (SEFAZMS). |
| **Link / Portal** | https://servicos.efazenda.ms.gov.br/pndfis/Home/Emissao |
| **Prazo de emissão** | Imediato quando emitida pela internet, sem pendências. |
| **Validade** | 60 dias para PF e PJ. 90 dias para pessoa jurídica de direito público. |
| **Formato de saída** | Arquivo PDF assinado digitalmente, com código de autenticação no portal da SEFAZ. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos. **Positiva com efeito de negativa**: débitos com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. A SEFAZ-MS emite a Certidão Tributária Estadual gratuitamente pela internet. Quando há débitos com exigibilidade suspensa, é necessário solicitar a Certidão Circunstanciada (positiva com efeito de negativa) pelo sistema e-SAP no e-Fazenda, mediante pagamento da Taxa de Serviços Estaduais (2 UFERMS). |

#### 11.2.2. Certidão Negativa de Débitos Estaduais — Vendedor Pessoa Jurídica

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Tributários Estaduais (em nome da pessoa jurídica vendedora). |
| **Órgão expedidor** | Secretaria da Fazenda de Mato Grosso do Sul (SEFAZMS). |
| **Link / Portal** | https://servicos.efazenda.ms.gov.br/pndfis/Home/Emissao |
| **Prazo de emissão** | Imediato via internet quando regular. |
| **Validade** | 60 dias para PF e PJ. 90 dias para pessoa jurídica de direito público. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva com efeito de negativa**, ou **positiva**. A certidão é válida para a matriz e suas filiais. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória para PJ. Apontamentos de ICMS podem indicar passivo fiscal relevante, capaz de gerar redirecionamento aos sócios. Se positiva pura, bloquear a minuta e exigir regularização ou comprovação de garantia. |

### 11.3. Justiça Federal — Tribunal Regional Federal da 3ª Região (TRF3) — abrange Mato Grosso do Sul e São Paulo.

O TRF3 atende MS e SP. Para fins de emissão regional, escolher a Seção Judiciária do MS. A emissão pode ser feita pelo Sistema de Certidão Unificada do CJF (https://certidao-unificada.cjf.jus.br) com seleção da seção judiciária do estado, ou diretamente pelo portal do TRF correspondente.

#### 11.3.1. Certidão Cível e Criminal da Seção Judiciária de Mato Grosso do Sul

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Judicial Cível e Criminal da Seção Judiciária de Mato Grosso do Sul. |
| **Órgão expedidor** | Tribunal Regional Federal da 3ª Região (TRF3) — abrange Mato Grosso do Sul e São Paulo. |
| **Link / Portal** | https://web.trf3.jus.br/certidao-regional/CertidaoCivelEleitoralCriminal |
| **Prazo de emissão** | Imediato para certidão negativa via internet. |
| **Validade** | 30 dias para fins contratuais. Para financiamento, abrangência usual de 10 anos. |
| **Formato de saída** | Arquivo PDF assinado digitalmente. |
| **Classificações possíveis** | **Negativa**, **positiva** (com indicação dos processos), ou **positiva com efeito de negativa**. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Esta certidão complementa a CND Federal Conjunta da Receita ao informar sobre processos judiciais federais — execuções fiscais ainda não inscritas, ações ordinárias contra a União, ações criminais federais. A base de contratos demonstra a relevância da emissão regional, especialmente em SP (TRF3) e RS (TRF4), onde a Justiça Federal tem volume processual elevado. |

### 11.4. Município de Campo Grande

As certidões municipais relativas ao imóvel são emitidas pela Prefeitura Municipal de Campo Grande. As certidões pessoais municipais (mobiliárias) só são exigíveis quando o vendedor PF ou PJ tem inscrição municipal ativa, geralmente vinculada à prestação de serviços (ISS).

#### 11.4.1. Certidão Negativa de Débitos de Tributos Imobiliários do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão Negativa de Débitos Imobiliários. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Campo Grande. |
| **Link / Portal** | https://www.campogrande.ms.gov.br/sefaz/servicos/certidao-negativa |
| **Prazo de emissão** | Imediato via internet quando o imóvel está regular. |
| **Validade** | 30 dias da emissão para fins contratuais. |
| **Formato de saída** | Arquivo PDF, com código de autenticação no portal da prefeitura. |
| **Classificações possíveis** | **Negativa**: inexistência de débitos de IPTU e taxas imobiliárias. **Positiva com efeito de negativa**: débitos parcelados em dia ou com exigibilidade suspensa. **Positiva**: débitos exigíveis. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. Em Campo Grande, a Prefeitura emite a Certidão Negativa de Débitos Imobiliários pela internet, vinculada ao cadastro do imóvel. |

#### 11.4.2. Certidão de Valor Venal e Dados Cadastrais do Imóvel

| Campo | Conteúdo |
|---|---|
| **Nome oficial** | Certidão de Valor Venal ou Certidão de Dados Cadastrais do Imóvel. |
| **Órgão expedidor** | Secretaria Municipal da Fazenda da Prefeitura de Campo Grande. |
| **Link / Portal** | https://www.campogrande.ms.gov.br/sefaz/servicos/certidao-negativa |
| **Prazo de emissão** | Imediato via internet. |
| **Validade** | Sem validade formal — a referência é o exercício fiscal vigente. |
| **Formato de saída** | Arquivo PDF. |
| **Classificações possíveis** | Documento informativo, não aplica classificação positiva ou negativa. Indica o valor venal apurado pela prefeitura para fins de IPTU. |
| **Regras de negócio (ContractMaker)** | Exigência obrigatória. O valor venal é referência para cálculo do ITBI e para confronto com o valor declarado de venda. Em municípios que adotam o maior dentre o valor venal e o valor de transação como base de cálculo do ITBI, a divergência é determinante. Para a base de cálculo do imposto de renda sobre ganho de capital, o valor da escritura é o relevante. |

#### 11.4.3. Certidão Negativa de Débitos Mobiliários e ISS — quando aplicável

Para vendedores PF ou PJ com inscrição municipal ativa em Campo Grande (geralmente prestadores de serviços contribuintes do ISS), exige-se também a certidão negativa de débitos mobiliários da prefeitura. O sistema deve ativar esta exigência apenas quando identificar inscrição municipal ativa em consulta prévia. Para vendedores sem inscrição municipal, é dispensável.

---

## 12. Situações especiais e diligências adicionais

As certidões padronizadas das seções anteriores cobrem o caso comum de vendedor PF capaz e PJ regular. Esta seção trata das situações que demandam diligência adicional, com regras condicionais que o ContractMaker deve aplicar quando identificar o cenário correspondente.

### 12.1. Vendedor estrangeiro

A venda por estrangeiro não residente exige cuidados específicos relacionados à identificação, capacidade e formalidades dos atos praticados fora do Brasil.

#### 12.1.1. Documentos de identificação

- **CPF brasileiro regularizado**: indispensável. Sem CPF, nenhum ato de transmissão imobiliária é possível. O CPF pode ser solicitado em consulado brasileiro no país de residência ou no Brasil por procuração.
- **Para estrangeiros residentes**: Carteira de Registro Nacional Migratório (CRNM, antiga RNE) válida. Estrangeiros com CRNM vencida que tenham completado 60 anos antes do vencimento estão dispensados de substituição (Decreto-Lei 2.236/1985 com redação da Lei 9.505/97).
- **Para estrangeiros não residentes**: passaporte válido como documento de identificação.

#### 12.1.2. Procuração outorgada no exterior

Por força do art. 657 do Código Civil e da prática registral consolidada, a procuração para venda de imóvel deve ser pública (instrumento público), não particular. Para que uma procuração lavrada no exterior produza efeitos no Brasil, o caminho varia conforme o país e a presença de consulado brasileiro:

- Em país signatário da Convenção da Apostila de Haia (caminho mais comum): a procuração é lavrada perante notário local, recebe a Apostila no próprio país, é traduzida no Brasil por tradutor público juramentado e registrada em Cartório de Registro de Títulos e Documentos.
- Em país com consulado brasileiro: a procuração pode ser lavrada diretamente pelo consulado brasileiro, dispensando apostilamento e tradução.
- Em país sem consulado brasileiro nem signatário da Convenção da Haia: legalização (consularização) na repartição consular brasileira mais próxima, tradução juramentada no Brasil e registro em Títulos e Documentos.

#### 12.1.3. Regras de negócio para o ContractMaker

Ao identificar vendedor estrangeiro (CPF emitido com indicação de residência no exterior, ou ausência de RNE/CRNM em sistema brasileiro), o sistema deve:

- Marcar a transação como "venda por estrangeiro" e ativar o conjunto especial de exigências.
- Exigir, além das certidões padrão, comprovante de origem dos recursos para fins de prevenção à lavagem de dinheiro e à evasão fiscal (Lei 9.613/98 e regulamentação do COAF).
- Validar a procuração: se outorgada no exterior, exigir registro em RTD e tradução juramentada anexados.
- Se vendedor casado, exigir anuência do cônjuge na procuração ou em instrumento separado, salvo no regime de separação total absoluta de bens.
- Em vendas para estrangeiros (lado comprador), o sistema deve verificar restrições aplicáveis a imóveis rurais e a áreas de fronteira ou de segurança nacional.

### 12.2. Espólio

Quando o vendedor falece antes da conclusão da transação, ou quando a transação envolve imóvel pertencente a espólio em inventário, a operação demanda regras específicas.

#### 12.2.1. Documentos adicionais para venda em fase de inventário

- Termo ou compromisso de inventariante, expedido pelo juízo onde tramita o inventário.
- Alvará judicial autorizando especificamente a venda do imóvel objeto do contrato — exigência indispensável quando há herdeiros menores, incapazes ou ausentes.
- Certidão de óbito do autor da herança.
- Anuência expressa de todos os herdeiros maiores e capazes, ou representação legal dos demais.
- Certidão Negativa de ITCMD (Imposto de Transmissão Causa Mortis e Doação), expedida pela SEFAZ do estado onde tramita o inventário.

#### 12.2.2. Quando o inventário é extrajudicial

Para inventários extrajudiciais lavrados em Tabelionato de Notas (autorizados pela Lei 11.441/2007 quando todos os herdeiros são maiores, capazes e há consenso), a venda subsequente do imóvel demanda apenas a Escritura Pública de Inventário e Partilha registrada na matrícula. Não há necessidade de alvará.

#### 12.2.3. Regras de negócio para o ContractMaker

- Ao identificar a palavra "espólio" na qualificação do vendedor ou status indicativo, o sistema deve ativar a trilha de espólio e exigir os documentos adicionais acima.
- Bloquear a minuta até apresentação do alvará judicial específico para venda, quando aplicável.
- Solicitar à SEFAZ estadual a Certidão Negativa de ITCMD em nome do espólio.
- Atentar para herdeiros estrangeiros: pode ser necessário processo de inventário no Brasil com representação por advogado e documentação apostilada.

### 12.3. Vendedor menor ou incapaz

A venda de imóvel pertencente a menor, interdito ou incapaz exige autorização judicial específica.

#### 12.3.1. Documentos adicionais

- Alvará judicial específico autorizando a venda do imóvel, com indicação clara da matrícula.
- Certidão de tutela ou curatela em nome do representante legal.
- Apresentação do termo de tutela ou curatela e do compromisso assumido.
- Certidão dos Ofícios de Interdições e Tutelas — exigida especialmente em transações no Rio de Janeiro, conforme prática consolidada na base de contratos.

#### 12.3.2. Regras de negócio

- Sem o alvará judicial específico para venda, o sistema deve bloquear a minuta sem exceção.
- O preço da venda deve ser destinado a depósito judicial ou a aplicação financeira em nome do menor ou incapaz, conforme determinação do juízo.
- Atenção a divergências entre os representantes legais: havendo conflito de interesses, é necessária a nomeação de curador especial.

### 12.4. Vendedor casado, em separação ou divórcio em curso

O regime de bens do casamento e a fase do procedimento dissolutório impactam diretamente a documentação exigível.

#### 12.4.1. Regimes de bens e exigências

- **Comunhão universal e comunhão parcial** (para bens adquiridos durante o casamento): ambos os cônjuges devem assinar a venda, ou um deles deve outorgar procuração ao outro com poderes específicos.
- **Separação total convencional**: cada cônjuge dispõe livremente de seus bens próprios. A anuência do outro é dispensável quanto a bens particulares.
- **Separação obrigatória legal** (art. 1.641 do CC): a anuência do outro cônjuge é dispensável, mas o vendedor deve apresentar comprovação do regime.
- **Participação final nos aquestos**: a venda exige autorização do outro cônjuge para os bens particulares se assim previsto no pacto antenupcial.

#### 12.4.2. Pacto antenupcial

Quando o regime de bens é diverso do legal (comunhão parcial), exige-se a apresentação de cópia do pacto antenupcial registrado no Cartório de Registro de Imóveis do primeiro domicílio do casal. Este documento, presente nos contratos da base, deve ser solicitado pelo sistema sempre que o vendedor declarar regime diferente do supletivo.

#### 12.4.3. Separação ou divórcio em curso

- Quando há ação de separação ou divórcio em andamento, o ContractMaker deve exigir certidão de objeto e pé do processo.
- Se houver determinação judicial de indisponibilidade ou bloqueio do bem, a venda fica suspensa.
- Se houver acordo homologado partilhando o imóvel, o documento da partilha deve constar da matrícula antes da venda.
- Em separação consensual extrajudicial, a Escritura Pública de Separação ou Divórcio com partilha de bens deve estar registrada na matrícula.

### 12.5. Falência ou recuperação judicial da pessoa jurídica vendedora

A constatação de processo falimentar ou recuperacional altera radicalmente as regras de venda do imóvel.

#### 12.5.1. Falência decretada

- A pessoa jurídica em falência perde a administração dos bens. A venda só pode ser feita pela massa falida, com autorização do juízo falimentar e observância da ordem legal de preferência (Lei 11.101/2005).
- Se identificada falência decretada, o ContractMaker deve bloquear a minuta sem exceção, encaminhando para análise jurídica especializada.

#### 12.5.2. Recuperação judicial em curso

- A empresa em recuperação judicial pode vender bens, inclusive imóveis, mas a venda fora do plano de recuperação demanda autorização do juízo recuperacional.
- Se prevista no plano de recuperação aprovado, a venda pode ocorrer sem autorização adicional, desde que respeitadas as condições.
- O ContractMaker deve, ao identificar recuperação, exigir certidão de objeto e pé do processo recuperacional, cópia do plano aprovado, e, quando aplicável, alvará judicial específico para a venda do imóvel.

### 12.6. Venda por procuração — caso geral

Mesmo fora do contexto de vendedor estrangeiro, a venda por procuração é frequente e demanda diligência específica.

#### 12.6.1. Requisitos da procuração para venda de imóvel

- Forma pública: lavrada em Tabelionato de Notas (art. 657 do Código Civil).
- Poderes expressos para alienar, com identificação clara do imóvel ou poderes gerais expressos para alienar todos os bens imóveis do mandante.
- Validade do traslado: a base de contratos demonstra a prática de exigir traslado da procuração com validade de 30 dias.
- Capacidade do mandante na data da outorga: presume-se, salvo prova em contrário.

#### 12.6.2. Diligências adicionais

- O ContractMaker deve verificar se a procuração não foi revogada antes da assinatura do contrato. A revogação deve ser averbada à margem do registro original em Tabelionato.
- Se o mandante faleceu após a outorga, a procuração se extingue automaticamente — exceção feita às procurações em causa própria (in rem suam), que produzem efeitos mesmo após a morte do outorgante.
- Para procurações antigas (mais de seis meses), recomendar emissão de procuração nova ou exigir declaração do mandante de manutenção dos poderes.

### 12.7. Imóveis com particularidades específicas

#### 12.7.1. Imóveis foreiros (RJ e áreas históricas)

Imóveis foreiros são aqueles cuja propriedade plena pertence à União, à Marinha, à Igreja ou ao Patrimônio Imperial, e cujo domínio útil pertence ao particular. Comuns em áreas centrais do Rio de Janeiro, Olinda, Petrópolis e em terrenos de marinha (orla litorânea de todo o país).

- Exigir Certidão de Foro e Laudêmio quitados, expedida pelo órgão titular do domínio (SPU para Marinha, SPU para União, Cúria para Igreja, Casa Imperial para Patrimônio Imperial).
- O laudêmio é devido na transmissão e equivale a 5% do valor do imóvel (em terras da União) ou conforme regra específica em outros casos.
- Sem a certidão de quitação, a transferência não pode ser registrada na matrícula.

#### 12.7.2. Imóveis com alienação fiduciária

- Imóveis com alienação fiduciária ativa pertencem ao credor fiduciário até a quitação do contrato.
- A venda pelo devedor fiduciante demanda anuência do credor (geralmente o banco) ou quitação prévia do financiamento.
- O ContractMaker deve identificar a alienação fiduciária pela leitura da matrícula e ativar a exigência de Termo de Anuência ou comprovante de quitação.

#### 12.7.3. Imóveis em condomínio

Embora este documento não contemple as certidões condominiais por opção do escopo, é importante lembrar que, na prática contratual e registral, a Declaração de Quitação de Cotas Condominiais e a Convenção do Condomínio são frequentemente exigidas — em especial pelos agentes financeiros em operações de financiamento.

### 12.8. Resumo operacional para o ContractMaker — Disparos condicionais

A tabela abaixo resume os gatilhos que o ContractMaker deve usar para ativar regras condicionais ao identificar cada cenário especial.

| Cenário detectado | Ação do sistema |
|---|---|
| Vendedor com endereço no exterior ou ausência de RNE | Ativar trilha de vendedor estrangeiro (12.1). Exigir CPF regularizado, procuração em forma específica (12.6), comprovação de origem dos recursos. |
| Termo "espólio" ou "inventariante" na qualificação | Ativar trilha de espólio (12.2). Exigir alvará judicial, termo de inventariante, CND-ITCMD, anuência dos herdeiros. |
| Vendedor menor de 18 anos ou interditado | Ativar trilha de incapaz (12.3). Bloquear sem alvará judicial específico para venda. |
| Regime de bens diverso de comunhão parcial | Exigir pacto antenupcial (12.4). |
| Ação de separação ou divórcio em curso | Exigir certidão de objeto e pé do processo. Verificar indisponibilidade ou bloqueio judicial do imóvel. |
| PJ vendedora com apontamento de falência | Bloquear minuta. Encaminhar para análise jurídica (12.5.1). |
| PJ vendedora em recuperação judicial | Exigir certidão de objeto e pé do processo recuperacional, cópia do plano e, quando aplicável, alvará judicial (12.5.2). |
| Procuração apresentada | Verificar forma pública, poderes expressos para alienar, validade do traslado, ausência de revogação (12.6). |
| Matrícula indica imóvel foreiro (Marinha, União, Igreja, Patrimônio Imperial) | Exigir Certidão de Foro e Laudêmio quitados (12.7.1). |
| Matrícula indica alienação fiduciária ativa | Exigir Termo de Anuência do credor ou comprovante de quitação (12.7.2). |
| Imóvel rural | Exigir CCIR atualizado e CND-ITR. Verificar restrições para venda a estrangeiros. |

---

## 13. Glossário operacional

Os termos abaixo são utilizados ao longo do documento e nos contratos da base de conhecimento. A consolidação aqui apresentada visa uniformizar a terminologia para o módulo de certidões.

**Certidão de objeto e pé** — Certidão emitida pelo cartório judicial que descreve o objeto e o estado atual de um processo específico. Exigida para esclarecer apontamentos positivos em certidões de distribuição, permitindo avaliar o risco real de cada processo.

**CND** — Certidão Negativa de Débitos. Atesta a inexistência de débitos no escopo pesquisado.

**CPEN** — Certidão Positiva com Efeito de Negativa. Atesta a existência de débitos cuja exigibilidade está suspensa por garantia, parcelamento, decisão judicial ou outro motivo legal — produzindo, juridicamente, os mesmos efeitos da CND.

**Certidão Positiva** — Atesta a existência de débitos exigíveis, sem qualquer causa suspensiva. É a classificação que tipicamente bloqueia o avanço do contrato e demanda regularização.

**Indisponibilidade** — Restrição judicial ou administrativa que impede a alienação de bens. Pode ser parcial (sobre bens determinados) ou total (sobre todo o patrimônio). Verificada pela Central Nacional de Indisponibilidade de Bens — CNIB.

**Alienação fiduciária** — Transferência fiduciária da propriedade ao credor como garantia de dívida. O devedor fiduciante mantém a posse direta, mas a propriedade plena permanece com o credor até a quitação. A venda exige anuência do credor ou quitação prévia.

**Imóvel foreiro** — Imóvel cuja propriedade plena pertence a um titular (União, Marinha, Igreja, Patrimônio Imperial) e cujo domínio útil pertence ao particular. A transmissão exige pagamento de laudêmio.

**Laudêmio** — Quantia devida ao titular da propriedade plena na transmissão de imóvel foreiro. Para terras da União, é de 5% sobre o valor venal do imóvel ou da transação, o que for maior.

**Foro** — Pensão anual paga pelo enfiteuta (titular do domínio útil) ao senhorio direto (titular do domínio direto), em imóveis foreiros.

**ITBI** — Imposto sobre Transmissão de Bens Imóveis, de competência municipal. Devido na transferência onerosa entre vivos. A alíquota varia entre municípios (em geral, 2% a 3% do valor da transação ou venal, o maior).

**ITCMD** — Imposto sobre Transmissão Causa Mortis e Doação, de competência estadual. Devido em transmissões por sucessão (espólio) ou doação.

**Matrícula** — Cadastro único e individualizado do imóvel no Cartório de Registro de Imóveis competente. Contém todo o histórico de aquisições, ônus, ações e averbações relativas ao imóvel.

**ONR** — Operador Nacional do Sistema de Registro Eletrônico de Imóveis. Centraliza a emissão de certidões de matrícula em formato digital com validade nacional.

**CENPROT** — Central Nacional de Serviços Eletrônicos dos Tabeliães de Protesto. Permite consulta gratuita e emissão de certidões oficiais de protesto.

**CNIB** — Central Nacional de Indisponibilidade de Bens, mantida pelo IRIB. Concentra ordens judiciais e administrativas de indisponibilidade patrimonial.

---

## 14. Considerações finais e atualização

Este documento reflete a estrutura e as regras vigentes em abril de 2026, consolidando as práticas observadas na base de contratos do negócio com as normas oficiais dos órgãos expedidores. Algumas dimensões mudam com frequência e devem ser revisitadas periodicamente:

- Migrações de sistemas de tribunais (notadamente PJe, eproc e SAJ), que alteram URLs e formatos de certidões.
- Atualizações de validade de certidões por meio de portarias e resoluções administrativas.
- Criação de novas certidões obrigatórias por exigência de tribunais, agentes financeiros ou órgãos reguladores.
- Mudanças em alíquotas de ITBI, ITCMD e taxas administrativas que podem afetar o fluxo de cobrança.

A revisão recomendada do conteúdo é semestral, com checagem ativa nos portais oficiais listados em cada certidão. O ContractMaker pode incorporar um indicador de última verificação por certidão para alertar quando o conteúdo precisa de validação.

### 14.1. Estrutura de prioridade para o disparo de certidões

Para otimizar a operação do módulo, sugere-se o seguinte sequenciamento de disparos pelo sistema:

- **Etapa 1** — Filtros de bloqueio imediato: CPF/CNPJ regular, CNIB, matrícula com inteiro teor de ônus.
- **Etapa 2** — Identificação de cenários especiais: análise dos dados das partes para acionar trilhas especiais (estrangeiro, espólio, incapaz, falência, recuperação).
- **Etapa 3** — Certidões federais: CND Federal Conjunta, CNDT, Justiça Federal.
- **Etapa 4** — Certidões estaduais e regionais: TJ do estado, TRT da região, SEFAZ e PGE.
- **Etapa 5** — Certidões municipais: tributos imobiliários, valor venal, mobiliários (se aplicável).
- **Etapa 6** — CENPROT e protestos.
- **Etapa 7** — Documentos pessoais e sociais (RG, CPF, certidão de casamento, contrato social, JUCESP).

Esse sequenciamento permite ao sistema identificar precocemente os bloqueadores absolutos (etapas 1 e 2) e evitar o desperdício de chamadas integradas em transações que não terão prosseguimento. Ao final, todas as certidões coletadas devem compor o dossiê documental do contrato, vinculado à matrícula do imóvel.

A estrutura modular deste documento permite que cada certidão seja tratada como uma unidade independente no sistema, com seus próprios parâmetros de validade, classificação, ação contingente e exigência condicional. Esta granularidade é o que permitirá ao ContractMaker funcionar como um motor de regras de negócio efetivo, e não como um simples checklist estático.
