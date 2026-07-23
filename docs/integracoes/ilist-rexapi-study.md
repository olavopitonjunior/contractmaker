# Estudo — Integração iList/RexAPI (Gryphtech) × Contractmaker

> Estudo realizado em 2026-07-23, com validação empírica (leitura + escrita) contra o **stage** na região 71 (ambiente de teste da Gryphtech). Credenciais no e-mail do Felipe (Gryphtech) de 2026-07-23 — **não commitadas neste doc**.
>
> Status: **estudo apenas** — nenhum código de produção, nenhuma migration. Arquitetura proposta ao final.

## 1. O que a RexAPI é

A RexAPI "Web" (`https://rexapi.stage.gryphtech.com` · prod `https://iconnect.rexapi.gryphtech.com`) é a **API de sincronização de listings** que alimenta o site público RE/MAX e o iList. Cobre **19 regiões RE/MAX do Brasil** (region IDs 56–96; **71 = ambiente de teste**), cada uma com `integratorId = Number("{regionId}001")`.

Recursos expostos (doc em `/Web/help`):

| Recurso | Operações | Notas |
|---|---|---|
| Authentication | `POST /api/v1/oauth/token` | §2 |
| Offices | GET list/detail · POST · PUT/PATCH · terminate · cancelalllistings · removeimage | agências/franquias |
| Associates | idem + TransferToOffice | corretores; `SalesLicenseNumber` (CRECI), `InternationalID` |
| Properties | GET list/detail · POST · PUT/PATCH · `PUT .../cancel` · TransferToAssociate | venda E locação |
| Property Descriptions | CRUD por (tipo, idioma) | Web=629, ListingTitle=1113; multilíngue (PTB/ENU/…) |
| Property Rooms | CRUD | cômodos |
| Property Images | CRUD | versões THUMBNAIL/WEB/LARGE/EXTRALARGE; pública em `{base}/userimages/{RegionID}/{img}` |
| Lookups | GET names · GET por `lookupName` | 39 tabelas de enums (§4) |
| Geo data | countries→regions→provinces→cities→localzones | Brasil = `CountryID 55`; `CityID` obrigatório em endereço |
| Files | download | data dictionaries + XSD |

### O que a RexAPI NÃO expõe

- ❌ **Leads / contatos / clientes** — existem no produto iList, mas não nesta API
- ❌ **Transações / status de negócio / transaction management**
- ❌ **Comissões, royalties, financeiro** (só `ComTotalPct`/`ComBuyAgentPct` no listing)
- ❌ **Relatórios**
- ❌ **Webhooks** — integração é 100% pull (delta por `ModifiedDate`)

**Perguntas em aberto pro Felipe (§8).**

## 2. Autenticação (validada ✅)

```
POST {base}/api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

=grant_type%3Dauthorization_code%26client_id%3D{APIKEY}%26code%3D{SECRETKEY}
```

- **Quirk crítico**: o body precisa começar com `=` seguido da query string inteira URL-encoded (validado — sem o `=` inicial não autentica).
- Resposta: `{ access_token, token_type: "token", expires_in: 172800 }` → **48h, sem refresh token**; renovar obtendo token novo.
- Requests autenticadas: `Authorization: OAUTH oauth_token="{token}", api_key="{apiKey}"`. HTTPS obrigatório; `Accept: application/json` (default é XML).
- Base validada no stage: `https://rexapi.stage.gryphtech.com/api/v1`.

### ⚠️ Escopo do token — achado de segurança relevante

**Um único token (apiKey+secretKey) acessa TODAS as 19 regiões** — validado: o mesmo token leu `integrator/71001/...` e `integrator/60001/...` (dados reais da RE/MAX São Paulo Capital no stage). O isolamento por região/office é responsabilidade **nossa** no app (o `integrator_id` é só um segmento de rota). No modelo por-org, o guard de `officeID`/`integratorId` tem que ser server-side nosso, nunca confiado ao client.

### ⚠️ Exposição de credenciais iList pela API

`GET offices` e `GET associates` retornam o objeto **`IListCredentials { Username, Password }` com senha em texto claro** dos usuários do iList. Implicações:
1. **Nunca** logar/persistir respostas cruas dessas rotas (redigir o campo no client HTTP).
2. Reportar ao Felipe — provavelmente é um resíduo de provisioning, mas é um vazamento sério se as credenciais de prod vazarem.

## 3. Validação empírica (região 71, stage)

### Leitura ✅

| Chamada | Resultado |
|---|---|
| `GET integrator/71001/offices?page=1&take=5` | 200 — 18 offices (QA) |
| `GET integrator/71001/associates?...` | 200 — 140 associates |
| `GET integrator/71001/properties?...&all=true` | 200 — 1.904 properties |
| `GET integrator/71001/lookups/names` | 200 — 39 tabelas |
| `GET integrator/71001/geodata/countries` | 200 — 221 países (BR=55) |
| `GET integrator/60001/offices` (mesmo token) | 200 — 72 offices REAIS (ex.: RE/MAX MAMEDE) |
| `GET propertydescriptions/{id}` | 200 — multilíngue (PTB, ENU) |
| `GET propertyImages/{id}` | 200 — metadados + URL pública |

### Escrita ✅ (ciclo completo, com limpeza)

| Passo | Resultado |
|---|---|
| `POST associates` (ExternalID `cmkstudy-a1`) | **201** — exige `InternationalID` + `MainSpecialization` (não documentado) |
| `PATCH associates/ext-cmkstudy-a1` (telefone) | **200** |
| `POST properties` (ExternalID `cmkstudy-p2`) | **201** — exige `ContractType` válido (default 0 → 400). **Nasce pública**: `IsOnPublicWebSite: true` imediato |
| `PATCH properties/ext-cmkstudy-p2` (preço) | **200** |
| `PATCH` `ListingStatus: 169 (Sold)` + `SoldDate` | **200** — persistido e confirmado por GET (`SoldDate` volta date-only) |
| `PUT properties/ext-.../cancel` | **200** — `ListingStatus: 161`, sai do site público |
| `PUT associates/ext-...` `Terminated: true` | **200** |

Outras validações: associate desabilitado bloqueia criação de property (400 com mensagem literal); PATCH em recurso inexistente → 404 com `MessageDetail` claro; erros de validação vêm em `ModelState` (400).

## 4. Enums essenciais (dump da região 71)

- **TransactionType**: `261` For Sale · `260` For Rent/Lease · `262` Holiday (deprecated)
- **ListingStatus** (lifecycle rico): `4812` Draft · `160` Active · `166` Prospective · `1616` **Proposal** · `164` On Option · `168` **Sale Agreed** · `169` **Sold** · `170` Sold by Other Agent · `171` Sold by Owner · `167` **Rented** · `165` Partially Rented · `162` Expired · `161` Cancelled
- **ContractType**: `25` Exclusive · `26` Exclusive Agency · `29` Open · `30` Semi-exclusive · `5475` Sole · `5476` Dual
- **CommercialResidential**: `1` Commercial · `2` Residential
- **PriceType**: `1901` Fixed Price · `2620` Monthly Rent · `5525` Negotiable · …
- **PaymentPeriod** (locação): `597` Monthly · `3140` Monthly Rent · `596` Annually · …
- **DescriptionType**: `629` Web · `1113` ListingTitle · `5685` Marketing Description · `1112` SMS · …
- **Associate_MainSpecialization**: `1311` Res · `1310` Comm · `1312` CommRes · `1313` ResComm
- **Associate_Title**: `1317` Associate · `1318` Owner · `1319` Manager · `5459` Rental Manager · …
- **Currency**: ISO (BRL = "Brazilian Reals")
- Sentinela de vazio: **`-999`** em numéricos (ex.: `CurrentListingPrice: -999`, `ContractType: -999`)

Campos de Property úteis além do óbvio: `ListingID` (código público RE/MAX), `ComTotalPct` / `ComBuyAgentPct` (percentuais de comissão!), `PropertyCategory` (`2867` RE/MAX Collection, `2868` RE/MAX Commercial), `MarketStatus`, `ExpiryDate`, `BuiltArea`, `LotSizeM2`, `ParkingSpaces`, `YearBuilt`, `Features` (CSV de UIDs), `IsPublicAvailable`/`IsOnPublicWebSite`. Typo da API: resposta traz `ExternaID` duplicando `ExternalID`.

## 5. Encaixe no Contractmaker

Nenhuma integração iList existe no repo hoje. Template de conector mais próximo: **Superlógica** (`src/lib/superlogica/{client,resources,types,endpoints}.ts`, read-only). Seam já projetado: **`src/app/api/locacao/crm/lookup/route.ts`** (stub 501 esperando um conector CRM, com `fields` já no shape de `POST /clients` e `/properties`).

| Necessidade | RexAPI | Encaixe |
|---|---|---|
| **Cadastro de imóveis** | ✅ total (validado R/W) | Locação: model `Property` (CRUD em `/api/locacao/properties/*`) + campo de origem (`crmId`-like). Vendas/propostas: picker que preenche `imoveis[]` do `SalesForm.dataJson` a partir do listing (endereço, matrícula não existe no iList — complementar à mão). Seam pronto: `crm/lookup` |
| **Cadastro de corretores** | ✅ Associates (validado R/W) | `SplitRecipient(kind=commissioner)` — já tem `creci`, `papel`, PIX/wallet; matcher em `src/lib/asaas/commissionados-matcher.ts`. `User`/`OrgMembership` se corretor logar. `SalesLicenseNumber` ↔ `creci` |
| **Leads/clientes** | ❌ não exposto | `Lead` (vendas) e `LeaseClient` (locação — já tem `source="crm"` + `crmId`). Bloqueado até a Gryphtech expor API de leads |
| **Status de negócio (push)** | ⚠️ via listing | Write-back validado: `Sale Agreed (168)` / `Sold (169)`+`SoldDate` / `Rented (167)` / `Proposal (1616)`. Seams: `auto-promote-signed.ts`, `mark-lost`, `mark-commission-paid`, hooks de proposta |
| **Relatórios** | ❌ | derivável apenas do catálogo sincronizado (listings × office × associate × ComTotalPct) |
| **Propostas** | ✅ leitura (+ status `Proposal`) | pré-preencher imóvel/corretor no `NovaPropostaDialog`; opcionalmente marcar listing como `1616 Proposal` |
| **Assinaturas** | n/a | permanece ClickSign; iList só alimenta dados de entrada |
| **Cobranças / split / royalties** | ❌ | permanece 100% Asaas. `ComTotalPct`/`ComBuyAgentPct` do listing podem pré-preencher a etapa de comissão. Royalty = novo `papel` em `SplitRecipient` + `composeSplits` (`src/lib/asaas/commission.ts`) |

### Mapeamento status pipeline → ListingStatus (write-back futuro)

| Evento Contractmaker | ListingStatus iList |
|---|---|
| Proposta aceita | `1616` Proposal (ou `168` Sale Agreed) |
| Envelope ClickSign fechado (venda) | `168` Sale Agreed |
| Comissão paga / negócio concluído (venda) | `169` Sold + `SoldDate` |
| Contrato de locação assinado | `167` Rented |
| Negócio perdido | (nada — listing volta a Active é decisão do corretor, não nossa) |

## 6. Arquitetura proposta (fase de implementação, quando aprovada)

1. **Conector** `src/lib/ilist/`: `client.ts` (fetch + token cache com margem — renovar em ~40h; redação de `IListCredentials` nas respostas), `resources.ts` (offices/associates/properties/lookups/geodata), `types.ts`, `enums.ts` (constantes dos UIDs §4 + refresh de lookups cacheado em DB/memória).
2. **Credenciais por org** (padrão `ClickSignAccount`/`AsaasAccount`): model `IListAccount { orgId, env (stage|production), regionId, integratorId, officeExternalIds String[], apiKeyEncrypted/IvBase64/TagBase64, secretKeyEncrypted/... }`. Guard server-side: toda chamada usa o `integratorId` da conta da org e filtra `officeID` — nunca aceitar região/office do client.
3. **Sync pull** (sem webhook do lado deles): cron `src/app/api/cron/ilist/sync/route.ts` (ex.: 30min) com delta `startDate=lastSyncAt`, paginação `take=100`, `all=true` pra capturar terminados. Upsert em `Property` (locação) por chave externa; associates → sugestão de `SplitRecipient`.
4. **Import por ID / picker**: implementar o stub `crm/lookup` (locação) e picker equivalente em vendas/propostas (busca por `ListingID`/endereço no catálogo sincronizado).
5. **Write-back opcional, flag por org, default OFF**: Sold/Rented/Sale Agreed nos seams de auto-promote. **Cuidado**: nunca criar listing Active via API em região real (publica imediatamente); write-back inicial deve se limitar a PATCH de status em listings existentes.
6. **QA sempre na região 71** (`integratorId 71001`, office QA `71003`); jamais escrever em região real fora de produção autorizada.

## 7. Riscos e gotchas (validados ou observados)

- Token global multi-região → isolamento por org é nosso (crítico).
- `IListCredentials` com senha em claro nas respostas (redigir + reportar).
- Property criada Active publica **na hora** no site RE/MAX.
- Campos obrigatórios não documentados: associate exige `InternationalID` + `MainSpecialization`; property exige `ContractType` válido.
- Sentinela `-999`; typo `ExternaID`; `SoldDate` date-only; stage tem **dados reais** de regiões reais (tratar como produção pra fins de LGPD).
- Sem webhook: latência = período do cron; sem rate limit documentado (usar `pLimit` e backoff como nas certidões).
- Doc oficial é ASP.NET help pages; data dictionaries/XSD em `/Web/help/files`.

## 8. Perguntas pro Felipe (Gryphtech)

1. Existe API de **leads/contatos** e/ou **transaction management** do iList (fora da RexAPI Web)? É o bloqueador pra sync de leads e status bidirecional.
2. Existe **webhook/push** de mudanças (listing/associate) ou o desenho é pull-only mesmo?
3. As credenciais enviadas têm permissão de **escrita em produção**? Há credencial read-only disponível (preferível pra fase 1)?
4. `IListCredentials` (username/senha em claro) vem nas respostas de offices/associates — é esperado? Dá pra desabilitar no nosso client_id?
5. Rate limits e SLA da API?
6. `InternationalID` do associate: qual a semântica/fonte correta pra novos cadastros?

---

**Transcrições completas da validação** (JSON): scratchpad da sessão de estudo (`probe-read-result.json`, `lookups-dump.json`, `probe-write-result.json`, `probe-write-prop-result.json`). Artefatos de teste criados na região 71 foram limpos (property `cmkstudy-p2` cancelada; associate `cmkstudy-a1` terminado).
