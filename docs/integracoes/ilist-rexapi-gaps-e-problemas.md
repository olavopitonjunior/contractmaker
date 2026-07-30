# Integração iList × Contractmaker — o que precisamos da API

> **Para:** Gryphtech (a/c Felipe). **De:** equipe Contractmaker / imobpro. **Data:** 2026-07-23.
> Baseado na integração da Fase 1 **já em produção** (catálogo de imóveis por região/office) e em validação prática de leitura e escrita da RexAPI (homologação região 71 + produção).

## Em uma frase

O **iList** é o CRM/catálogo; o **Contractmaker** é a transação (contrato, assinatura, due diligence, cobrança, comissão). Hoje a API entrega bem o catálogo, mas é praticamente **só de ida**: nada do que a transação produz — status da negociação, contrato assinado, cliente qualificado, comissão distribuída — consegue **voltar** ao iList. Precisamos fechar esse ciclo.

---

## 1. O que já temos (funciona hoje)

Tudo abaixo verificado na prática e em uso na Fase 1:

- **Offices** — leitura completa (CRUD disponível). Inclui `LicenseNumber` = **CRECI PJ da imobiliária** (útil pra qualificar a intermediadora no contrato).
- **Associates (corretores)** — nome, e-mail, telefone, office, e um perfil bem modelado no schema: `SalesLicenseNumber`/`BrokerLicenseNumber` (**CRECI**, com validade/estado), atividades, especializações, `TeamStatus`, áreas de atuação, página pública. **Ressalva:** o CRECI (`SalesLicenseNumber`) veio **vazio** no QA — o campo existe, mas pode não estar populado; validar em produção.
- **Imóveis** — leitura rica (venda e locação): preço, tipo, quartos/vagas/áreas, endereço, fotos, descrições multilíngues, corretor, `ContractType` (exclusividade), `ExpiryDate`, comissão do anúncio. Além do óbvio, campos **úteis pro contrato que já vêm** e que não estávamos usando:
  - **`SoldPrice` + `SoldPriceCurrency`** — o **VGV realizado** do imóvel vendido (confirmado populado em BRL em todos os vendidos da amostra). Vem junto de `SoldDate`.
  - **`MaintenanceFee`** (condomínio, com período) e **`ParkingCost`** (custo de vaga) — entram direto no contrato.
  - **`PropertyStatus`** (lookup) = **ocupação/posse**: Owner Occupied / Tenant Occupied / Vacant / Under Construction — vira cláusula de posse/entrega.
  - Endereço mais fino que o esperado: **`ApartmentNumber`**, `AddressLine2` e **`District` (bairro) em texto** (só a cidade fica em `CityID`).
  - Mídia: `GeoCoordinates`, `YouTube`, `VirtualTourURL` (tour 360).
- **Fotos, descrições, geodata e lookups** — funcionam.
- **Escrita** — `PATCH` de `ListingStatus` (Sale Agreed / Sold / Rented) validado; **`SoldPrice` e `SoldDate` também são graváveis** no listing (parte do XSD oficial, ao lado do `SoldDate` que já testamos).

Ou seja: o **catálogo entra** bem — e com mais campos de contrato do que imaginávamos. O que falta é quase tudo do lado das **pessoas** e da **volta estruturada**.

---

## 2. O que precisamos (por prioridade)

**P0 — bloqueia o ciclo:**

1. **Clientes** (venda e locação) — CRUD de pessoas com papéis (vendedor, comprador, locador, pretendente, locatário), vínculo com imóvel e corretor, e recepção/envio de leads. Hoje **não existe** — o listing nem referencia o proprietário. Sem isso, o corretor redigita partes que já estão no CRM, e o cliente que qualificamos na venda nunca volta pro iList.
2. **Negociações** — uma entidade de negócio em andamento (imóvel + partes + valor + estágio + datas), com endpoints de **escrita** para devolvermos cada marco: proposta → aceite → contrato → assinado (com PDF) → fechado (com VGV/comissão) → perdido. Hoje só existe o status do anúncio. *Nuance nova:* o **fechamento** já é parcialmente devolvível hoje — dá pra gravar `ListingStatus` + **`SoldPrice`** + `SoldDate` (+ `PossessionDate`, no schema) no listing, o que já dá VGV e data à franqueadora. O que ainda falta é o **caminho do meio** (proposta, contraproposta, aceite, partes envolvidas) e o vínculo com o cliente — que o status do anúncio não carrega.
3. **Anexos** — pelo menos na negociação e no imóvel, para o **contrato assinado** e a **autorização de captação** voltarem ao CRM. Hoje só há fotos de divulgação.
4. **Correção de segurança** — `GET offices`/`associates` devolvem `IListCredentials` com **senha em texto claro** de usuários reais (risco de LGPD). Precisa parar de vir na resposta.

**P1 — completa a integração:**

5. **Comissão realizada** (volta) — quem recebeu quanto e quando (o Contractmaker já executa o split bancário). *Nuance nova:* a **ida** é mais rica do que só `ComTotalPct` — o schema do imóvel modela comissão fixa (`ComTotalFix`), indicação/referral com fonte (`ComReferralPct`/`ComRefSource`), co-corretagem (`CoopCommision`) e, na locação, comissão em **meses de aluguel** (`RentalCommissionMonths`). Falta o **realizado** (split efetivo por participante, com datas) de volta.
6. **Royalties** — não pedimos cálculo pronto; basta a devolução de negociação fechada (VGV + comissão bruta por office) para a franqueadora calcular. Alternativa: expor a tabela de % e nós devolvemos o valor.
7. **Captação estruturada** — exclusividade, vigência (início/fim/renovação) e o **documento** anexado. Hoje só `ContractType` + `ExpiryDate` soltos.
8. **Campos registrais BR no imóvel** — matrícula, cartório, inscrição IPTU/SQL (o contrato exige; hoje o corretor completa à mão) + vínculo com o **proprietário** (o listing não referencia o vendedor). *Refinamento:* número do apto e bairro já vêm; o que falta mesmo é o bloco **registral** + a cidade em texto (hoje só `CityID`).
9. **Perfis de usuário e multi-office** — *refinamento:* o perfil do corretor **é modelado** (licenças com validade, atividades, especializações, `TeamStatus`), mas pode vir **não-populado** (CRECI vazio no QA) e não há um campo de **papel/permissão** claro (corretor × gerente × adm). Falta também a semântica de `MacroOfficeID` / `AdditionalOfficeList` (aparecem no payload sem documentação) e o **autor da alteração** (as respostas têm `CreatedDate`/`ModifiedDate` mas não *quem* mudou).
10. **Webhooks + credencial escopada** — hoje é 100% *pull* (varremos a cada 6h) e o token acessa **todas** as regiões (o `integrator_id` da rota é só um seletor). Webhooks e credencial por-região com opção read-only.

**P2 — conveniência:**

11. **Busca server-side** (texto, código, faixa de preço) e **relatórios agregados** — deriváveis se as negociações existirem.

> **Confirmação:** sondamos exaustivamente a superfície da RexAPI Web (rotas `clients`, `leads`, `contacts`, `negotiations`, `transactions`, `deals`, `attachments`, `documents`, `webhooks`, `subscriptions` e rotas-índice) — **todas retornam 404**. O índice de ajuda lista apenas 10 recursos (offices, associates, properties, descriptions, rooms, images, lookups, geodata, files, auth). Não há entidade de cliente, negociação, anexo ou webhook escondida — os P0 acima realmente não existem na API hoje.

---

## 3. Sugestão de como poderia ser

Não é prescritivo — é o formato que resolveria os P0 com o menor atrito, seguindo o padrão REST que a RexAPI já usa.

**Clientes** (espelha o modelo de imóveis/associates):
```
GET/POST/PATCH  integrator/{id}/clients
  { ExternalID, Type: "buyer|seller|tenant|landlord|prospect",
    Name, Email, Phone, Document (CPF/CNPJ),
    AssociateExternalID, PropertyExternalID?, Source, Notes }
POST  integrator/{id}/clients/{id}/history   // interações (lição: histórico por entidade)
```

**Negociações** (a peça central — a devolução):
```
POST/PATCH  integrator/{id}/negotiations
  { ExternalID,               // nossa chave (idempotência)
    PropertyExternalID, Stage: "proposal|agreed|contract|signed|closed|lost",
    Amount, Currency, Parties: [clientExternalID...],
    StageDate, LostReason? }
POST  integrator/{id}/negotiations/{id}/attachments
  { Type: "signed_contract|listing_authorization|inspection", File }
POST  integrator/{id}/negotiations/{id}/commission   // realizado
  { GrossAmount, Splits: [{ associateExternalID, Pct|Amount, PaidAt }] }
```
Com isso, o `ListingStatus` do anúncio passa a ser atualizado **pelo próprio iList** como consequência da negociação — não por nós sobrescrevendo o listing.

**Webhook** (a mão contrária do pull):
```
iList → POST {nossa_url}
  { Event: "listing.updated|client.created|negotiation.updated", ExternalID, ... }
  Header: X-Signature: hmac-sha256(payload, secret)
```

**Credencial**: uma chave read-only escopada à região para leitura de catálogo; a chave de escrita (devolução) escopada e idempotente.

---

## 4. Perguntas em aberto

1. Existe (ou está no roadmap) uma API de **clientes/leads** e de **negociações/transações** fora da RexAPI Web? Como obtemos acesso?
2. Há **webhooks/push**, ou o desenho é intencionalmente pull-only?
3. Enquanto não há entidade de negociação, o **write-back de `ListingStatus`/`SoldDate`** é a via oficial para sinalizar fechamento?
4. O retorno de **`IListCredentials`** com senha em claro é intencional? Dá para desligar no nosso `client_id`?
5. Existe credencial **read-only** e **com escopo por região**? As nossas têm escrita em produção?
6. Qual a semântica de **`MacroOfficeID`** e **`AdditionalOfficeList`**?
7. Existe **regra de split de comissão** e **tabela de royalties** no iList que possam ser expostas?
8. **Rate limits** e SLA da API?

---

## Apêndice — correções pontuais na API atual (verificadas)

### Evidência do item crítico (captura direta da API)

Capturado em **2026-07-23 21:53 UTC**, região 71 (homologação). Resposta crua da API, sem edição:

```
$ GET /api/v1/integrator/71001/offices?page=1&take=3
  → 200 OK — Office ID 71003
{
  "ID": 71003,
  "OfficeName": "GRUPO Red",
  "Email": "qatest@gryphtech.com",
  "IListCredentials": {
    "Username": "71003office",
    "Password": "R102030f",
    "UserDisabled": false
  }
}

$ GET /api/v1/integrator/71001/associates?page=1&take=3
  → 200 OK — Associate ID 710031017
{
  "ID": 710031017,
  "AgentName": "Camila Herrero",
  "Email": "qatest@gryphtech.com",
  "IListCredentials": {
    "Username": "71003CBernardes",
    "Password": "br6403M@X",
    "UserDisabled": false
  }
}
```

`Password` é um campo string top-level, em texto puro. Na primeira página: **5/5 offices** e **5/5 associates** retornam o bloco `IListCredentials`. O mesmo campo vem nas regiões de **produção** — não é exclusivo do ambiente de teste. O vazamento é **estrutural**: `IListCredentials` é um tipo compartilhado (`common` XSD) herdado por office e associate — desligar exige mudança no tipo base, não num endpoint. E não é só senha: o associate também expõe **`DateOfBirth`** e o schema modela **`SIN`** (tax id do corretor) — mais PII sensível.

| # | Item | Severidade |
|---|---|---|
| 1 | `IListCredentials { Username, Password }` com **senha em texto claro** (evidência acima), estrutural (tipo comum), acompanhado de `DateOfBirth`/`SIN` do corretor | Crítico (LGPD) |
| 2 | **Token global** — acessa (e escreve) todas as regiões; `integrator_id` é só seletor | Alto |
| 3 | **Homologação com dados reais de produção** (ex.: região 60) | Alto |
| 4 | `geodata?geoLevel=cities` **sem `clientRegionID` devolve a base mundial** (1.500.763 cidades / 15.008 páginas); com o filtro, ~5.797 do Brasil. A doc lista o filtro como opcional | Alto |
| 5 | **Bug de paginação:** a **página 1 devolve `take − 1`** (pula o 1º item). `take=100` → 99 itens; `take=500` → 499. Paginando a coleção inteira, **perde-se 1 registro** por listagem. Mitigar sempre pelo envelope `TotalCount`/`HasNextPage`, nunca por `Items.length` | Alto |
| 6 | `POST properties` Active **publica na hora** no site público (sem rascunho) | Médio |
| 7 | Obrigatórios não documentados: associate exige `InternationalID`+`MainSpecialization`; property exige `ContractType` (default 0 → 400) | Médio |
| 8 | Token: body do `oauth/token` **precisa começar com `=`**; sem refresh (48h); header proprietário (`Bearer` → 401 enganoso) | Médio |
| 9 | Geodata: nomes com padding (`"Vitoria    "`); província inconsistente (`"Cuiabá"` como província do Centro-Oeste) | Médio |
| 10 | Sem `ETag`/`Last-Modified` (sem requisição condicional); servidor expõe `x-aspnet-version`/`x-powered-by` (leak de versão); data dictionaries e XSDs públicos em `/StaticFiles/v1/` sem autenticação | Baixo |
| 11 | Sentinela `-999`; typo `ExternaID`; `SoldDate` date-only; sem campo "quem alterou"; `ContractType` tem 8 valores (o help sugere menos); páginas de help desatualizadas vs XSDs | Baixo |

*Documentos internos relacionados: estudo técnico da RexAPI e visão de assistentes/agentes — não enviar à Gryphtech.*
