# RexAPI (iList) — Lacunas de API e problemas técnicos para o projeto Contractmaker

> **Destinatário:** equipe técnica Gryphtech (a/c Felipe).
> **Autor:** equipe Contractmaker / imobpro.
> **Data:** 2026-07-23.
> **Base da análise:** integração real da Fase 1 (catálogo de imóveis + provisionamento por região/office) já em funcionamento, mais validação empírica de leitura **e** escrita contra o ambiente de homologação (`rexapi.stage.gryphtech.com`), região **71** (ambiente de teste) e produção (`iconnect.rexapi.gryphtech.com`).

Este documento tem dois objetivos: **(1)** listar as capacidades de API que o projeto precisa e que **hoje não existem** na RexAPI, cada uma com o caso de uso concreto que a motiva; e **(2)** relatar **problemas técnicos observados** na API atual que impactam a integração — vários com implicação de segurança/LGPD. Tudo aqui foi verificado na prática, não é especulação.

---

## 0. O que já integramos (contexto)

O Contractmaker é uma plataforma de gestão de vendas e locação imobiliária (esteira: lead → formulário → contrato → assinatura eletrônica → cobrança). Na Fase 1 conectamos a RexAPI para **puxar o cadastro de imóveis** de cada imobiliária RE/MAX para dentro dos fluxos de contrato:

- Provisionamento por **(região, office)** — o administrador vincula um tenant à sua região e aos seus offices.
- **Sincronização** dos listings (`GET properties` paginado, incremental por `ModifiedDate`, com resolução de `associates` e `geodata`) para um catálogo local de busca.
- **Picker de imóvel** em três fluxos: confecção de contrato de venda, cadastro de imóvel de locação e proposta comercial.

Endpoints usados hoje: `oauth/token`, `offices`, `associates`, `properties` (list + detail), `propertydescriptions`, `propertyImages`, `geodata`, `lookups`. A integração funciona — o que segue é o que **falta** para completar a visão do produto, e o que **atrapalha** no que existe.

---

## 1. Lacunas de API (capacidades ausentes)

Prioridades: **P0** = bloqueia um pilar do produto; **P1** = degrada muito a experiência / exige workaround custoso; **P2** = desejável.

### 1.1 [P0] API de Leads / Contatos (CRUD + push)

**Situação:** o iList tem gestão de leads e contatos (a própria comunicação de marketing do produto destaca "responder a novos leads do site de qualquer lugar"), mas **não há endpoint REST** para eles na RexAPI. A superfície pública cobre apenas listings/associates/offices.

**Caso de uso:** a esteira do Contractmaker nasce num lead. Sem API de leads não conseguimos: (a) originar um negócio a partir de um lead já existente no iList do corretor; (b) devolver ao iList o lead que chega pelos nossos formulários públicos; (c) manter o CRM do corretor como fonte única de contatos.

**Pedido:** endpoints de leads/contatos com CRUD e, idealmente, webhook de criação/atualização. Campos mínimos: nome, telefone(s), e-mail, origem, corretor responsável, status, e o imóvel/associate de interesse.

### 1.2 [P0] Status de negócio / Transações (transaction management)

**Situação:** a RexAPI não expõe o módulo de transações do iList. O único sinal de "andamento" disponível é o `ListingStatus` do imóvel (Active → Sale Agreed → Sold / Rented / Cancelled).

**Caso de uso:** quando um contrato é assinado ou uma comissão é paga na nossa plataforma, isso deveria refletir no iList. Hoje o único caminho é **escrever o status no próprio listing** (`PATCH .../properties/{id}` mudando `ListingStatus` para `168 Sale Agreed` / `169 Sold` / `167 Rented`) — o que é um *workaround*, não uma integração de transação: não carrega valor negociado, partes, datas de fechamento nem comissão.

**Pedido:** endpoints de transação (criar/atualizar um negócio vinculado a um listing, com estágio, valor, partes e datas), ou ao menos documentação oficial confirmando que o write-back de `ListingStatus`/`SoldDate` é a via suportada para sinalizar fechamento.

### 1.3 [P1] Webhooks / notificações de mudança

**Situação:** a integração é **100% pull**. Não há webhook de "listing criado/alterado", "associate desligado", etc. Detectamos mudanças relendo tudo com filtro `startDate`/`endDate` sobre `ModifiedDate`.

**Caso de uso:** para manter o catálogo local fresco sem latência, hoje rodamos um cron a cada 6 horas. Um imóvel novo ou uma mudança de preço leva até 6h para aparecer. Webhooks eliminariam a defasagem e o custo de varredura.

**Pedido:** webhooks configuráveis por integrador (listing/associate/office created|updated|deleted), com HMAC de assinatura.

### 1.4 [P1] Busca textual / filtragem server-side de listings

**Situação:** `GET properties` só filtra por `officeID`/`associateID` e data de modificação. Não há busca por texto (endereço, código público `ListingID`, bairro), faixa de preço, número de dormitórios, tipo, etc.

**Caso de uso:** o corretor busca "o apê da Rua X" ou "código 1234". Sem busca na API, tivemos que **espelhar o catálogo inteiro localmente** e indexar por conta própria só para permitir a busca. Isso funciona, mas obriga a sincronização completa e o armazenamento de todos os listings de cada office.

**Pedido:** parâmetros de busca/filtro em `GET properties` (texto livre, `listingId`, faixa de preço, quartos, `transactionType`, `propertyType`, cidade).

### 1.5 [P2] Relatórios / agregações

**Situação:** não há endpoints de relatório (ex.: nº de listings ativos por office, por corretor, tempo médio até Sold).

**Caso de uso:** painéis gerenciais do tenant. Hoje derivamos o que dá do catálogo espelhado; métricas de transação/tempo dependem de 1.2.

### 1.6 [P1] Campos cadastrais brasileiros no imóvel

**Situação:** o `Property` não tem **matrícula do registro de imóveis, cartório, inscrição de IPTU/SQL** — dados essenciais para um contrato de compra e venda no Brasil.

**Caso de uso:** ao importar um imóvel do iList para um contrato, esses campos ficam vazios e o corretor preenche à mão. Não é bloqueante (o formulário completa), mas é retrabalho e fonte de erro.

**Pedido:** campos opcionais de registro (matrícula, cartório, inscrição municipal/IPTU, SQL para SP) no modelo de Property, ou um bloco de "documentação do imóvel".

### 1.7 [P1] Credencial com escopo e perfil read-only

**Situação:** a credencial fornecida (`apiKey` + `secretKey`) gera um token que **acessa todas as regiões** e permite **escrita**. Ver detalhe no problema 2.2.

**Caso de uso:** para uma integração de leitura de catálogo, precisaríamos de uma credencial **read-only** e **restrita à(s) região(ões)** do integrador. Hoje, por segurança, temos que garantir todo o isolamento no nosso lado.

**Pedido:** credenciais com escopo por região e um perfil somente-leitura.

### 1.8 [P2] Suporte a agentes conversacionais (WhatsApp / assistentes)

**Situação/Caso de uso:** operamos assistentes digitais que atendem corretores (consulta de imóveis, geração de proposta, acompanhamento de negócio) e fazem análise de crédito/seguro-fiança para locação. Para os tenants RE/MAX, esses assistentes precisam consultar o portfólio do corretor e o andamento do negócio. As lacunas 1.1–1.4 são o que limita esses assistentes hoje; um canal de eventos (1.3) e a API de leads (1.1) os destravam. *(Detalhamento interno à parte.)*

---

## 2. Problemas técnicos observados (todos verificados na prática)

Ordenados por severidade.

### 2.1 [CRÍTICO / LGPD] Credenciais de usuário do iList retornam em texto claro

`GET offices` e `GET associates` retornam, para cada registro, um objeto **`IListCredentials { Username, Password }` com a senha em texto claro** do usuário iList correspondente.

- **Evidência:** validado na região 71 — cada office/associate traz o bloco preenchido (ex.: um associate retornou `IListCredentials` com `Username` e `Password` legíveis).
- **Impacto:** qualquer integrador com o token consegue coletar senhas de usuários reais do iList. É exposição de credencial de terceiros — risco direto de LGPD e de comprometimento de contas. No nosso lado, redigimos o campo no cliente HTTP antes de qualquer log/persistência, mas **a API não deveria devolvê-lo**.
- **Pedido:** remover `IListCredentials` das respostas (ou, no mínimo, torná-lo opcional e desligado por padrão para credenciais de integração).

### 2.2 [ALTO] Token global sem escopo — um integrador acessa dados de todos

O token emitido por `oauth/token` **não é restrito à região do integrador**. Com a mesma credencial, uma chamada a `integrator/71001/...` e a `integrator/60001/...` retorna dados reais de ambas as regiões (validamos: a credencial de teste leu o catálogo real da região 60).

- **Impacto:** o `integrator_id` na rota é apenas um seletor, não um limite de autorização. Todo o isolamento entre integradores fica por conta do consumidor. Combinado com 2.1, o risco é sistêmico.
- **Pedido:** vincular o token à(s) região(ões) autorizada(s) da credencial e rejeitar `integrator_id` fora do escopo.

### 2.3 [ALTO] Homologação (stage) contém dados reais de produção

O ambiente `rexapi.stage.gryphtech.com` serve **dados reais** de regiões de produção (ex.: região 60 — RE/MAX São Paulo Capital, com nomes de imobiliárias e corretores reais), não apenas a região de teste 71.

- **Impacto:** qualquer teste em "stage" está tocando PII de produção. Para nós, isso obriga a tratar o stage com o mesmo rigor de LGPD que produção e a restringir QA à região 71.
- **Pedido:** stage com dados sintéticos, ou segregação clara do que é dado de teste.

### 2.4 [MÉDIO] Criação de listing publica imediatamente no site público

Um `POST properties` com `ListingStatus = 160 (Active)` faz o imóvel **aparecer imediatamente no site público** (`IsOnPublicWebSite: true` na resposta), sem etapa de rascunho/revisão.

- **Impacto:** integrações de escrita precisam de muito cuidado; não há "staging" de um listing antes de publicar. No nosso desenho, por isso, não criamos listings — só sinalizamos status de listings existentes.
- **Pedido:** suporte a criar em rascunho (`Draft` = 4812) por padrão, publicando só sob ação explícita.

### 2.5 [MÉDIO] Campos obrigatórios não documentados

Alguns campos obrigatórios não constam na documentação e só foram descobertos por tentativa/erro:

- `POST associates` exige `InternationalID` **e** `MainSpecialization` (sem eles: HTTP 400 `ModelState`).
- `POST properties` exige `ContractType` válido — o valor default `0` retorna `400 "ContractType error(s): Invalid value 0"`.

**Pedido:** documentar os campos obrigatórios reais de cada `POST`.

### 2.6 [MÉDIO] Fluxo de token não-padrão e frágil

O `POST oauth/token` **exige que o corpo comece com um caractere `=`** seguido dos parâmetros URL-encoded (ex.: `=grant_type%3D...`). Sem o `=` inicial, a autenticação falha silenciosamente. Além disso:

- Não há **refresh token** — o `access_token` vale 48h e precisa ser reobtido do zero.
- O cabeçalho de autenticação é `Authorization: OAUTH oauth_token="...", api_key="..."` (formato próprio; `Bearer` retorna 401 enganoso).

**Pedido:** aceitar `application/x-www-form-urlencoded` padrão (sem o `=` inicial), documentar o formato do header, e considerar refresh token.

### 2.7 [BAIXO] Inconsistências de payload

- **Sentinela `-999`:** campos numéricos "vazios" voltam como `-999` (ex.: `CurrentListingPrice: -999`, `ContractType: -999`) em vez de `null`. Consumidores precisam normalizar.
- **Typo `ExternaID`:** a resposta de `properties` traz `ExternaID` (sem o "l") **além** de `ExternalID`.
- **`SoldDate` sem hora:** ao gravar `SoldDate` com timestamp, a leitura retorna apenas a data (date-only).
- **Documentação de ajuda desatualizada:** as páginas de help (`/Web/help/...`) não refletem os campos obrigatórios reais nem a lista completa de `ListingStatus`/lookups que a API efetivamente retorna.

---

## 3. Pedidos priorizados (resumo)

| # | Item | Prioridade | Tipo |
|---|------|-----------|------|
| 2.1 | Parar de retornar `IListCredentials` (senha em claro) | **CRÍTICO** | Segurança |
| 2.2 | Token com escopo por região + rejeitar `integrator_id` fora do escopo | **ALTO** | Segurança |
| 1.1 | API de Leads/Contatos (CRUD + webhook) | **P0** | Capacidade |
| 1.2 | API de Transações / status de negócio | **P0** | Capacidade |
| 2.3 | Stage sem dados reais de produção | ALTO | Segurança |
| 1.3 | Webhooks de mudança | P1 | Capacidade |
| 1.4 | Busca/filtragem server-side de listings | P1 | Capacidade |
| 1.7 | Credencial read-only | P1 | Segurança |
| 1.6 | Campos cadastrais BR no imóvel | P1 | Capacidade |
| 2.4 | Criar listing em rascunho | MÉDIO | Comportamento |
| 2.5 | Documentar campos obrigatórios | MÉDIO | Documentação |
| 2.6 | Fluxo de token padrão + refresh | MÉDIO | Robustez |
| 1.5 | Relatórios/agregações | P2 | Capacidade |
| 2.7 | Sentinela -999, typo `ExternaID`, doc desatualizada | BAIXO | Qualidade |

---

## 4. Perguntas para a Gryphtech

1. Existe uma **API de leads/contatos** e/ou de **transações** do iList fora da RexAPI Web? Se sim, como obtemos acesso? (destrava 1.1 e 1.2)
2. Há **webhooks/push** de mudanças, ou o desenho é intencionalmente pull-only? (1.3)
3. As credenciais que recebemos têm permissão de **escrita em produção**? Existe credencial **read-only** e com **escopo por região**? (1.7 / 2.2)
4. O retorno de `IListCredentials` com senha em texto claro é intencional? Pode ser desativado para o nosso `client_id`? (2.1)
5. Quais são os **rate limits** e o SLA da API? (não documentados)
6. Qual a **semântica correta de `InternationalID`** ao cadastrar um associate novo? (2.5)
7. O **write-back de `ListingStatus`/`SoldDate`** é a via oficial suportada para sinalizar fechamento de negócio, ou há um endpoint de transação? (1.2)

---

*Anexo técnico com as transcrições das chamadas de validação (leitura e escrita, região 71) disponível sob demanda.*
