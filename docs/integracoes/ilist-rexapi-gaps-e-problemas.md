# Integração iList × Contractmaker — Especificação de necessidades de API

> **Destinatário:** Gryphtech (a/c Felipe) — times de produto e engenharia.
> **Autor:** equipe Contractmaker / imobpro.
> **Data:** 2026-07-23 (v2 — reescrito com foco de negócio).
> **Base da análise:** integração real da Fase 1 **já em funcionamento** (catálogo de imóveis por região/office + uso nos fluxos de contrato), mais validação empírica de leitura e escrita contra homologação (região 71) e produção (`iconnect.rexapi.gryphtech.com`).
> **Benchmark de referência:** API pública do **Vista CRM (Loft)** — padrão de mercado no Brasil para integração de CRM imobiliário.

---

## 1. O contexto de negócio — por que esta integração existe

A jornada de uma imobiliária RE/MAX passa por dois mundos:

```
CAPTAÇÃO ─► ANÚNCIO ─► LEAD ─► NEGOCIAÇÃO ─► CONTRATO ─► ASSINATURA ─► COMISSÃO ─► ROYALTIES
└────────────── iList (CRM/catálogo) ─────────────┘ └────────── Contractmaker (transação) ──────────┘
```

- O **iList** é a fonte de verdade do CRM: imóveis captados, corretores, agências, leads e o relacionamento comercial.
- O **Contractmaker** é a fonte de verdade da transação: o contrato (compra e venda ou locação), a assinatura eletrônica, a due diligence documental, a cobrança e a liquidação da comissão (split entre corretores via conta de pagamentos).

O valor da integração está no **ciclo completo**: os dados do CRM alimentam a transação sem redigitação, e **tudo que a transação produz volta ao CRM** — status da negociação, contrato assinado, comissão distribuída, imóvel vendido/alugado. Sem a volta, o iList fica cego a partir do momento em que a negociação começa, e a franqueadora perde a base para relatórios e royalties.

**O estado atual da RexAPI é uma via de mão única e parcial:** ela entrega bem o catálogo (imóveis, corretores, agências), entrega nada de clientes/negociações, e o único caminho de devolução é sobrescrever o status do anúncio. Este documento especifica, domínio por domínio, o que o negócio precisa que a API **entregue** e **receba de volta** — e por quê.

---

## 2. Modelo de dados requerido — domínio a domínio

Formato de cada item: **O que é · Por que o negócio precisa · O que a RexAPI oferece hoje (verificado) · O que falta · Fluxo desejado (ida ↔ volta) · Benchmark Vista**.

### 2.1 Usuários e perfis

- **O que é:** as pessoas que operam o sistema — corretor, gerente/coordenador, administrativo, dono da agência — com papel e permissões.
- **Por quê:** o Contractmaker espelha o acesso por perfil (quem vê quais negócios, quem aprova contrato, quem emite cobrança). Sem saber o papel do associate no iList, todo provisionamento de acesso é manual e diverge com o tempo. Além disso, um negócio precisa ser **atribuído** ao corretor certo — e o corretor precisa ser reconhecido nos dois sistemas como a mesma pessoa.
- **Hoje:** `associates` traz nome, e-mail, telefone, CRECI (`SalesLicenseNumber`), office e flags soltas (`IsSalesAssociate`, `BrokerLicensed`). Não há papel/perfil utilizável, e o único vínculo de "login" retornado é o bloco `IListCredentials` — que expõe a senha em texto claro (Apêndice A.1) e não serve como identidade de integração.
- **Falta:** papel/perfil do usuário (corretor, gerente, adm, owner), status de acesso, e um identificador de identidade estável para SSO/matching (e-mail verificado ou ID federado).
- **Fluxo desejado:** *ida* — perfis e papéis junto do associate; *volta* — nada obrigatório (gestão de usuários permanece no iList).
- **Vista:** clientes e imóveis vêm com corretor e agência aninhados; a chave de API é emitida por gestor de contrato, separando identidade de integração de credencial de usuário.

### 2.2 Agências e multi-office

- **O que é:** a estrutura organizacional — região master → grupo econômico → offices — e corretores que atuam em mais de um office.
- **Por quê:** comissão, relatório e royalty são calculados **no office certo**. Um grupo com 5 offices precisa consolidar visão sem misturar tenants; um corretor multi-office precisa ter cada negócio atribuído ao office da captação/venda.
- **Hoje:** `offices` funciona bem (validado). Os payloads trazem `MacroOfficeID` e `AdditionalOfficeList` — sinais de que a estrutura existe — mas **sem documentação nem semântica** utilizável.
- **Falta:** documentação/semântica de `MacroOfficeID` (grupo econômico?) e `AdditionalOfficeList` (multi-office do corretor?); endpoint de hierarquia (região → grupos → offices).
- **Fluxo desejado:** *ida* — hierarquia completa; *volta* — nada.
- **Vista:** busca de clientes e imóveis "por agência" é nativa; a agência é entidade de primeira classe nas consultas.

### 2.3 Clientes de venda (compradores e vendedores)

- **O que é:** o cadastro de pessoas do funil de venda — proprietário-vendedor (dono do imóvel captado) e comprador/interessado (lead que evolui).
- **Por quê:** todo contrato de compra e venda começa e termina em pessoas. Na ida, o corretor não deveria redigitar o vendedor que já está no CRM desde a captação. Na volta, o comprador que o Contractmaker qualificou (com CPF, estado civil, endereço, documentos validados para o contrato) é um ativo de CRM valiosíssimo — hoje ele **não volta** para o iList, e o CRM do corretor empobrece a cada venda fechada.
- **Hoje:** **inexistente.** A RexAPI não expõe clientes, leads nem o proprietário do imóvel (o listing não referencia o vendedor).
- **Falta:** recurso completo de clientes/contatos: CRUD, vínculo com imóvel (proprietário de, interessado em), vínculo com corretor responsável, origem do lead, histórico de interações.
- **Fluxo desejado:** *ida* — proprietário junto do listing + leads/interessados; *volta* — `POST/PATCH` de cliente com dados qualificados na transação (comprador que fechou, vendedor com cadastro completado) + evento "negócio fechado com o cliente X".
- **Vista:** é o segundo pilar da API — clientes com busca por corretor e por agência, detalhe, **histórico**, imóveis favoritos, criação/atualização e **recepção de leads** via API.

### 2.4 Clientes de locação (locadores, locatários e pretendentes)

- **O que é:** o mesmo domínio, no funil de aluguel — proprietário-locador, pretendente (candidato a locatário, que passa por análise de crédito/seguro-fiança) e locatário efetivado.
- **Por quê:** a locação é metade da operação de várias agências RE/MAX. O Contractmaker roda a esteira completa (ficha do pretendente → análise de crédito → garantia → contrato → administração), e cada etapa gera dado de CRM que hoje morre fora do iList: o pretendente reprovado numa análise é lead para outro imóvel; o locatário ativo é cliente recorrente (renovação, compra futura).
- **Hoje:** inexistente (o listing de locação existe — `TransactionType 260`, validado — mas sem pessoas associadas).
- **Falta:** o mesmo recurso de clientes de 2.3, com papéis de locação (locador/pretendente/locatário) e status da relação (em análise, aprovado, contrato ativo, encerrado).
- **Fluxo desejado:** *ida* — locador junto do listing + pretendentes; *volta* — resultado da análise (aprovado/reprovado, sem dados sensíveis de crédito), contrato ativo, encerramento.
- **Vista:** o modelo de clientes é único e serve aos dois funis; a finalidade (venda/locação) vive no imóvel e no relacionamento.

### 2.5 Documentos e anexos

- **O que é:** os arquivos que sustentam a operação: do **imóvel** (matrícula, IPTU, habite-se, convenção), do **cliente** (RG/CPF, comprovantes, certidões), da **captação** (autorização de venda/locação assinada) e do **negócio** (proposta aceita, contrato assinado, distrato).
- **Por quê:** a due diligence é o coração do risco imobiliário — o Contractmaker coleta e valida esses documentos (OCR, certidões automáticas). E o produto final da transação — **o contrato assinado eletronicamente** — hoje não tem para onde voltar no iList: o corretor fecha a venda e o CRM não guarda o instrumento.
- **Hoje:** só **imagens de divulgação** do imóvel (`propertyImages`, validado). Nenhum outro tipo de anexo, em nenhuma entidade.
- **Falta:** anexos genéricos (arquivo + tipo + entidade vinculada) em imóvel, cliente, captação e negociação.
- **Fluxo desejado:** *ida* — documentos já arquivados no iList na captação; *volta* — `POST` de documento (contrato assinado em PDF, autorização de captação assinada, laudo de vistoria) vinculado ao listing/negociação.
- **Vista:** a API de imóveis documenta **anexos de documentos** além de fotos — exatamente o padrão pedido aqui.

### 2.6 Informações dos imóveis

- **O que é:** a ficha completa do imóvel — física, comercial e **registral**.
- **Por quê:** é a parte que já usamos em produção (o formulário do contrato nasce preenchido a partir do listing). O que falta é o que o contrato brasileiro exige e o anúncio não: **matrícula, cartório, inscrição de IPTU/SQL**. Sem eles, o corretor completa à mão — retrabalho e risco de erro no documento mais importante da transação.
- **Hoje:** bom: preço, tipo, quartos/vagas/áreas, endereço (rua/número/CEP + `CityID`), fotos, descrições multilíngues, corretor, `ContractType`, comissão do anúncio. Verificado e em uso.
- **Falta:** campos registrais BR (matrícula, cartório, inscrição municipal/IPTU, SQL); cidade/UF **textuais** no payload (hoje só o `CityID` numérico, resolvido via geodata — que tem seus próprios problemas, Apêndice A.7/A.8); vínculo com o proprietário (2.3).
- **Fluxo desejado:** *ida* — ficha completa; *volta* — `PATCH` dos campos registrais que o Contractmaker apurou na due diligence (matrícula confirmada em certidão, por exemplo) — devolvendo qualidade de dado ao catálogo.
- **Vista:** ficha com campos dinâmicos (endpoint de "campos disponíveis"), fotos, anexos, histórico e proprietário — o modelo de completude a mirar.

### 2.7 Negociações — informações, status e devolução

- **O que é:** a entidade que representa **o negócio em andamento**: imóvel + partes + valor + estágio (proposta → contraproposta → aceite → contrato → assinado → fechado / perdido) + datas.
- **Por quê (o item mais importante deste documento):** é aqui que os dois sistemas se encontram. O corretor gerencia o funil no iList; a execução (proposta formal, contrato, assinatura) acontece no Contractmaker. Sem uma entidade de negociação na API: (a) o funil do iList congela no momento em que a proposta vira contrato; (b) gerentes perdem visão de pipeline; (c) relatórios e royalties (2.9/2.10) ficam sem base de cálculo; (d) o corretor faz dupla digitação de status — que na prática ele não faz, e os dados divergem.
- **Hoje:** **não existe negociação.** O ciclo de status disponível é o do anúncio (`ListingStatus`: Active → Sale Agreed → Sold / Rented...), que validamos conseguir escrever via `PATCH` no listing. É um workaround: sinaliza o desfecho, mas não carrega valor negociado, partes, datas intermediárias nem quem participou.
- **Falta:** recurso de negociação/transação com CRUD + transições de estágio.
- **Fluxo desejado (detalhado, porque é o coração da devolução):**
  - *ida* — negociações abertas no iList (lead qualificado → visita → proposta verbal) para o Contractmaker dar sequência formal;
  - *volta* — a cada marco da transação, o Contractmaker devolve um evento estruturado:
    | Marco no Contractmaker | Devolução ao iList |
    |---|---|
    | Proposta formal enviada | negociação em "proposta", valor ofertado, validade |
    | Proposta aceita | "aceite", valor acordado |
    | Contrato gerado/em assinatura | "contrato", partes confirmadas |
    | Contrato assinado (100%) | "assinado", data, **PDF anexado** (2.5) |
    | Comissão liquidada | "fechado", VGV final, comissão bruta (base de 2.8/2.9) |
    | Negócio perdido | "perdido", motivo |
  - Cada escrita idempotente (chave externa nossa), com `ListingStatus` do anúncio atualizado como consequência **pelo próprio iList** — não por nós.
- **Vista:** o modelo público cobre imóvel+cliente+histórico; a lição do benchmark aqui é o **histórico por entidade** (todo evento tem onde ser registrado).

### 2.8 Distribuição de comissão

- **O que é:** como a comissão da transação se divide — captador, corretor vendedor, coordenador, a própria agência, eventualmente um parceiro externo.
- **Por quê:** o Contractmaker **executa** essa distribuição de verdade (split bancário via conta de pagamentos, com liquidação individual). O iList define as regras comerciais na origem (percentual do anúncio, papéis). Hoje a ida é parcial e a volta é zero — a agência não consegue ver no CRM quem recebeu o quê.
- **Hoje:** o listing traz `ComTotalPct` e `ComBuyAgentPct` (verificado — inclusive já usamos o `ComTotalPct` para semear a comissão do contrato). Nada além disso.
- **Falta:** *ida* — a regra de split completa por papel (se existir no iList); *volta* — endpoint para registrar a comissão **realizada**: valor bruto, divisão por participante (corretor A 40%, corretor B 40%, casa 20%), datas de liquidação.
- **Fluxo desejado:** ida da regra → execução no Contractmaker → devolução do realizado vinculado à negociação (2.7).

### 2.9 Cálculo de royalties

- **O que é:** o percentual devido à franqueadora/máster sobre a produção (comissão bruta/VGV) de cada office.
- **Por quê:** é a razão de ser da rede. O cálculo exige exatamente o dado que hoje não circula: **transações fechadas com valor e comissão por office**. Se a devolução de 2.7+2.8 existir, o iList (ou a franqueadora) passa a ter a base auditável de royalties sem depender de planilha manual das agências — ganho direto para a Gryphtech e para as regiões master.
- **Hoje:** nada (não há transações na API).
- **Falta/Fluxo desejado:** ou (a) o iList expõe a **tabela de royalties** (percentuais por região/office/faixa) e o Contractmaker pré-calcula e devolve o valor junto do fechamento; ou (b) o Contractmaker devolve apenas VGV + comissão bruta (2.7) e o cálculo fica no lado iList/franqueadora. Recomendamos (b) como mínimo — é só consequência da devolução de negociações.

### 2.10 Relatórios

- **O que é/Por quê:** a visão gerencial que agência, região e franqueadora precisam: **produção por corretor e por office** (VGV, nº de transações, comissão), **funil de negociações** (conversão por estágio), **aging de captação** (tempo em carteira, vencimento de exclusividade), **comissões e royalties por período**.
- **Hoje:** nenhum endpoint de relatório/agregação. Derivamos o que dá do catálogo espelhado (listings ativos por corretor); tudo que envolve transação é impossível sem 2.7.
- **Falta/Fluxo desejado:** não pedimos endpoints de BI prontos — pedimos **os dados-fonte** (negociações, comissões, captações com datas). Com eles, cada lado monta seus relatórios. Endpoints agregados são bem-vindos, mas são P2 se os dados-fonte existirem.

### 2.11 Captações (agenciamento)

- **O que é:** o contrato entre proprietário e imobiliária que autoriza a venda/locação — com **exclusividade (ou não), prazo de vigência e documento assinado**.
- **Por quê:** a captação é o estoque da imobiliária. Exclusividade e prazo determinam prioridade comercial e disputa de comissão; o vencimento é um evento de negócio (renovar ou perder a carteira). E o instrumento em si — a autorização assinada — é exatamente o tipo de documento que o Contractmaker gera e assina eletronicamente hoje, sem ter para onde devolvê-lo.
- **Hoje (parcial, verificado):** o listing traz `ContractType` (lookup com Exclusive, Exclusive Agency, Sole, Open, Semi-exclusive, Dual — bom vocabulário!) e `ExpiryDate`. É o embrião do domínio.
- **Falta:** estrutura de vigência (início, fim, renovação) além do `ExpiryDate` solto; o **documento da captação anexado** (2.5); histórico de renovações; e escrita: hoje esses campos são graváveis no listing, mas sem semântica de "captação" documentada.
- **Fluxo desejado:** *ida* — captação com exclusividade/prazo/documento; *volta* — autorização gerada e assinada no Contractmaker anexada ao listing + atualização de vigência na renovação.

### 2.12 Mecânica de entrega e devolução (transversal)

Para os fluxos acima funcionarem em produção:

1. **Webhooks** (iList → Contractmaker): listing/associate/office/cliente/negociação criados ou alterados, com assinatura HMAC. Hoje somos 100% *pull* (varremos por `ModifiedDate` a cada 6h) — funcional, mas com defasagem e custo.
2. **Endpoints de escrita idempotentes** (Contractmaker → iList): todos os `POST/PATCH` de devolução aceitando uma chave externa nossa, para reenvio seguro.
3. **Credencial com escopo**: por região (hoje o token acessa todas — Apêndice A.2) e com perfil read-only para consumo de catálogo. A devolução usaria a credencial de escrita, escopada.
4. **Busca/filtragem server-side** nos recursos de leitura (texto, código, faixa de preço) — reduziria nossa necessidade de espelhar catálogos inteiros. O Vista oferece filtros avançados (AND/OR), ordenação, paginação e seleção de campos em todas as consultas.

---

## 3. Resumo — RexAPI hoje × benchmark Vista × necessário

| Domínio | RexAPI hoje | Vista (Loft) | Necessário (prioridade) |
|---|---|---|---|
| 2.1 Usuários e perfis | Associates sem papel/perfil | Corretor/agência aninhados nas entidades | Papéis + identidade estável (**P1**) |
| 2.2 Multi-office | Offices ok; `MacroOfficeID` sem semântica | Busca por agência nativa | Hierarquia documentada (**P1**) |
| 2.3 Clientes de venda | **Inexistente** | Recurso completo (histórico, leads, favoritos) | CRUD + vínculo imóvel/corretor + leads (**P0**) |
| 2.4 Clientes de locação | **Inexistente** | Mesmo recurso, dois funis | Idem, com papéis de locação (**P0**) |
| 2.5 Documentos/anexos | Só fotos de divulgação | **Anexos de documentos no imóvel** | Anexos em imóvel/cliente/captação/negociação (**P0** p/ negociação, P1 demais) |
| 2.6 Ficha do imóvel | Boa; sem campos registrais BR | Campos dinâmicos + proprietário + histórico | Matrícula/cartório/IPTU/SQL + proprietário (**P1**) |
| 2.7 Negociações | **Inexistente** (só status do anúncio) | Histórico por entidade | Entidade de negociação + escrita por marco (**P0 — o coração**) |
| 2.8 Comissão | `ComTotalPct`/`ComBuyAgentPct` (ida parcial) | — | Regra de split (ida) + realizado (volta) (**P1**) |
| 2.9 Royalties | Nada | — | Consequência de 2.7+2.8 (**P1**) |
| 2.10 Relatórios | Nada | Filtros/agregação nas consultas | Dados-fonte primeiro; agregados P2 |
| 2.11 Captações | `ContractType` + `ExpiryDate` (embrião) | — | Vigência estruturada + documento anexado (**P1**) |
| 2.12 Mecânica | Pull-only, token global | Filtros ricos, chave gerenciada | Webhooks + escrita idempotente + escopo (**P0/P1**) |

---

## 4. Pedidos priorizados

| # | Pedido | Prioridade | Motivo de negócio |
|---|---|---|---|
| 1 | **Entidade de negociação** com escrita por marco (2.7) | **P0** | Fecha o ciclo; base de funil, relatórios e royalties |
| 2 | **Clientes** (venda e locação) com CRUD + leads (2.3/2.4) | **P0** | Origem e devolução do ativo de CRM |
| 3 | **Anexos** ao menos em negociação/listing (2.5) | **P0** | Contrato assinado e autorização de captação de volta ao CRM |
| 4 | Corrigir **`IListCredentials`** (senha em claro — A.1) | **P0 (segurança)** | Exposição de credencial de terceiros / LGPD |
| 5 | **Webhooks** + escrita idempotente (2.12) | P1 | Tempo real e confiabilidade da devolução |
| 6 | Credencial com **escopo por região** + read-only (2.12/A.2) | P1 | Isolamento entre integradores |
| 7 | Campos **registrais BR** no imóvel + proprietário (2.6) | P1 | Contrato sem redigitação |
| 8 | **Comissão**: regra de split (ida) + realizado (volta) (2.8) | P1 | Transparência da distribuição no CRM |
| 9 | Semântica **multi-office** documentada (2.2) | P1 | Grupos econômicos e corretor multi-office |
| 10 | **Captação** estruturada com documento (2.11) | P1 | Gestão de carteira e renovação de exclusividade |
| 11 | Perfis/papéis de usuário (2.1) | P1 | Espelhamento de acesso |
| 12 | Busca server-side; relatórios agregados (2.10/2.12) | P2 | Conveniência sobre os dados-fonte |

## 5. Perguntas objetivas para a Gryphtech

1. Existe (ou está no roadmap) uma API de **clientes/leads** e de **negociações/transações** fora da RexAPI Web? Como obtemos acesso? *(destrava os três P0 de capacidade)*
2. Há **webhooks/push**, ou o desenho é intencionalmente pull-only?
3. O **write-back de `ListingStatus`/`SoldDate`** é a via oficial para sinalizar fechamento enquanto não há entidade de negociação?
4. O retorno de **`IListCredentials`** com senha em claro é intencional? Pode ser desligado para o nosso `client_id`?
5. Existe credencial **read-only** e **com escopo por região**? As nossas têm escrita em produção?
6. Qual a semântica de **`MacroOfficeID`** e **`AdditionalOfficeList`**?
7. Existe regra de **split de comissão** e tabela de **royalties** no iList que possam ser expostas?
8. **Rate limits** e SLA da API?

---

## Apêndice A — Problemas técnicos verificados na API atual

Todos reproduzidos na prática durante a integração (evidências e transcrições disponíveis).

| Ref. | Problema | Severidade |
|---|---|---|
| A.1 | `GET offices`/`associates` retornam **`IListCredentials { Username, Password }` com senha em texto claro** de usuários reais | **Crítico / LGPD** |
| A.2 | **Token global sem escopo**: a mesma credencial lê (e escreve) em todas as regiões — o `integrator_id` da rota é só um seletor | Alto |
| A.3 | **Stage contém dados reais de produção** (ex.: região 60 com imobiliárias/corretores reais) — obriga tratar homologação como produção | Alto |
| A.4 | `geodata?geoLevel=cities` **sem `clientRegionID` retorna a base mundial: 1.500.763 cidades em 15.008 páginas** (doc lista o filtro como opcional); com o filtro: ~5.797 cidades BR em 58 páginas | Alto |
| A.5 | `POST properties` com `ListingStatus Active` **publica imediatamente no site** (`IsOnPublicWebSite: true`), sem rascunho | Médio |
| A.6 | Campos obrigatórios não documentados: `POST associates` exige `InternationalID` + `MainSpecialization`; `POST properties` exige `ContractType` válido (default 0 → 400) | Médio |
| A.7 | Fluxo de token não-padrão: o body do `POST oauth/token` **precisa começar com `=`**; sem refresh token (48h); header proprietário `OAUTH oauth_token=...` (Bearer → 401 enganoso) | Médio |
| A.8 | Qualidade do geodata: nomes com **padding** (`"Vitoria    "`); hierarquia inconsistente (ex.: `ProvinceName: "Cuiabá"` sob `RegionName: "Região Centro-oeste"`) — resolução de UF não confiável | Médio |
| A.9 | Sentinela **`-999`** em numéricos vazios; typo **`ExternaID`** duplicando `ExternalID`; `SoldDate` date-only; páginas de help desatualizadas vs comportamento real | Baixo |

---

*Documentos relacionados (internos Contractmaker): estudo técnico da RexAPI (`ilist-rexapi-study.md`) e visão de assistentes/agentes (`ilist-visao-agentes.md`).*
