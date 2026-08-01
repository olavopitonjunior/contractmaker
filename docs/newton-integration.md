# Newton — Integration surface

> Documentação para consumidores externos que vão chamar a API do contractmaker em nome de um usuário (hoje: agente Newton via WhatsApp). Vivo conforme `apps/web/src/lib/auth/api-token.ts`, `auth-or-bearer.ts`, `audit/newton.ts`, `api/idempotency.ts`. Atualizar quando essas libs mudarem.

## 0. Escopo atual do agente nos grupos (2026-07-25)

**O Newton não captura mais informação por iniciativa própria.** Foram removidos:

- `/api/cron/newton-requests/sweep` — cron horário que re-cobrava pedidos pendentes
  no grupo/contato (1×/dia por pedido, janela 7h–22h SP). Saiu de `vercel.json`, do
  `KNOWN_CRON_PATHS` do painel de staging-crons e do catálogo da UI.
- O disparo imediato em `POST /api/deals/:dealId/newton-requests`. Criar pedido hoje
  só grava a `NewtonRequest`; nenhum turn vai ao sidecar.

O inbox (`NewtonRequest` + aba "Pendências" no negócio) virou **registro interno** da
negociadora: serve pra saber o que falta e de quem depende. Quem vai atrás é pessoa.

Sobrou de proativo, e é intencional:

| Superfície | O que dispara | Por quê fica |
|---|---|---|
| `triggerNewtonForRequest({kind:"create"})` | `lib/surveys/channels.ts` | entrega de pesquisa de satisfação por WhatsApp, one-shot por convite |
| `triggerNewtonForRequest({kind:"cancel"})` | `PATCH .../newton-requests/:id` | derruba lembretes que o Newton agendou no passado (`cronJobIds`) — o web não fala com o cron do gateway |
| `notifyDealEvent` / sweep de `Notification` | eventos do processo | notificação a corretor/usuário que optou por WhatsApp, não captura de dado |
| `/api/cron/newton-requests/group-match` | horário | só resolve deal↔grupo (`DealGroupLink`). Não envia mensagem |

**Comportamento no grupo (aplicado em 2026-07-25):** o Newton só responde quando é
chamado direto com `@` ou reply, e o único fluxo de escrita permitido é **criar
formulário de negócio** — tool `create_form`, que já cria o Deal (`create_deal` não
existe como tool MCP). Esse gate é do runtime do agente (openclaw na VPS), não deste
repo: mudar `vercel.json` não silencia o agente por si só. A política foi gravada em
`SOUL.md` + `AGENTS.md` via Mission Control → Persona. Detalhes em
[newton-escopo-grupos.md](newton-escopo-grupos.md); o que foi escrito, em
[newton-persona-snapshot-2026-07-25.md](newton-persona-snapshot-2026-07-25.md).

**Crons do lado Newton:** auditados na aba Crons do MC — só `morning-briefing` e
`stale-deals`, ambos com destino `telegram→` do Olavo, nenhum em grupo de WhatsApp, e
sem execução há ~1 mês. Não havia cron de relatório em grupo.

**Descrições das tools MCP** (`apps/mcp-server/src/tools.ts`) foram alinhadas: elas
mandavam explicitamente "cobra via `whatsapp_send`, agenda lembretes" e "ao fechar,
MANDE TAMBÉM um DM". Política no prompt brigando com instrução na tool é briga perdida.

**Efeito colateral conhecido:** os executores de locação
(`lib/locacao/executors/{dunning,detect-late-payment,suggest-readjustment,approve-repasse,request-inspection-feedback}.ts`)
criam `NewtonRequest` sem chamar o trigger — dependiam do sweep pra chegar ao
WhatsApp. Sem o sweep, essas réguas **só registram no inbox**. Ambas as features do
Newton (`vendas.newton`, `locacao.newton`) são default OFF no catálogo.

## 1. Autenticação por API token

### 1.1 Geração do token (UI / session-only)

Endpoint: `POST /api/me/api-tokens`

Auth: session NextAuth (cookie). **Não aceita Bearer** — token novo precisa de identidade humana.

Body:
```json
{
  "name": "Newton (VPS prod)",
  "scopes": ["deals:rw", "contracts:rw", "charges:rw", "signatures:rw", "documents:rw", "metrics:r"],
  "expiresInDays": 365
}
```

Response 201 (uma vez):
```json
{
  "rawToken": "cmt_aBcD...",   // exibir UMA vez, nunca persistir em log/UI
  "token": { "id": "...", "name": "...", "scopes": [...], "expiresAt": null, "createdAt": "..." },
  "warning": "Salve o rawToken agora. Não será exibido novamente."
}
```

### 1.2 Lista e revogação

- `GET /api/me/api-tokens` — lista (sem `rawToken` ou `hashedToken`).
- `DELETE /api/me/api-tokens/{id}` — revoga (idempotente).

### 1.3 Uso pelo cliente externo

Header HTTP em toda chamada:

```
Authorization: Bearer cmt_aBcD...
X-Newton-Actor: <userId>          (opcional; obrigatório se token é shared service-account)
X-Idempotency-Key: <uuid-v4>      (POST/PATCH/DELETE — uma key por intenção)
```

### 1.4 Escopos

| Escopo | Permite |
|---|---|
| `deals:rw` | CRUD de deals |
| `contracts:rw` | CRUD de contratos, comments, suggestions |
| `charges:rw` | Cobranças Asaas, splits |
| `signatures:rw` | Envelopes ClickSign |
| `documents:rw` | Anexos, OCR |
| `metrics:r` | Read-only de métricas, lookup por telefone |

Scope check: handlers chamam `hasScope(ident, "...")`. Para auth via session, todos os scopes são considerados presentes. Hierarquia `X:rw ⊇ X:r`: endpoint que exige `deals:r` aceita token com `deals:rw`.

**Bearer exige rota com scope declarado (2026-07-24).** `requireAuth` (legado, `lib/auth/context.ts`) retorna **403** para Bearer em rota que não declara `{ scope }` — essas rotas são session-only por definição. Antes, qualquer token válido da org acessava toda a superfície `requireAuth(req)` sem scope (financeiro, DIMOB, dual-approvals), muito além do documentado aqui. A tentativa é auditada como `API_TOKEN_AUTH_FAILED` com `reason: bearer_on_unscoped_route`. Rotas que agentes consomem foram escopadas explicitamente:

| Rota | Scope |
|---|---|
| `GET /api/certidoes` | `documents:r` |
| `GET /api/financeiro/charges` | `charges:r` |
| `GET /api/contracts/[id]/envelopes` | `signatures:r` |
| `GET /api/deals/[dealId]/envelopes` | `signatures:r` |
| `PATCH /api/deals/[dealId]/envelopes/[envelopeId]` | `signatures:rw` |
| `GET/POST/DELETE /api/deals/[dealId]/commission-charges/draft` | `charges:rw` |
| `POST /api/deals/[dealId]/commission-charges/validate` | `charges:rw` |

## 2. Header `X-Newton-Actor`

Quando uma chamada Bearer representa um usuário humano (proxy):

- **Bearer + sem header** → ator é o `userId` dono do token. `metadata.via = "newton"` no AuditLog.
- **Bearer + header igual ao token.userId** → mesma coisa.
- **Bearer + header diferente** → REJEITA com 403 (tentativa de spoofing). Audit `NEWTON_ACTOR_HEADER_REJECTED`.
- **Session + header presente** → REJEITA com 400 (UI não deveria mandar esse header).
- **Session + sem header** → comportamento atual da UI.

Implementação em `src/lib/audit/newton.ts` `resolveNewtonActor(req, ident)`.

## 3. Idempotência

Header `X-Idempotency-Key` em POST/PATCH/DELETE. Servidor garante que mesma `(userId, key)` dentro de 24h retorna mesma resposta.

- TTL: 24h (constante `IDEMPOTENCY_TTL_HOURS`).
- Não cacheia 5xx (retry deve poder redo).
- Cleanup: cron diário chama `cleanupIdempotencyKeys()`.

Implementação em `src/lib/api/idempotency.ts`. Helper `withIdempotency()` envolve handler.

## 4. Endpoints novos para Newton

### 4.1 Lookup por telefone

`GET /api/users/by-phone?phone=%2B5511987654321`

- Auth: Bearer (escopo `metrics:r`) **ou** session.
- Phone format: E.164, validação via `phoneE164Schema`.
- Response 200: `{ userId, orgId, role, name }` — sem email (privacy).
- Response 404: usuário não encontrado, soft-deleted (LGPD), ou sem org membership.

### 4.2 Métricas pessoais — `GET /api/me/metrics`

Auth: Bearer (escopo `metrics:r`) ou session.

Query: `?since=ISO8601` (opcional, default últimos 30 dias).

Response:
```json
{
  "since": "...",
  "until": "...",
  "deals": { "total": 8, "byStage": { "stage-1": 3, "stage-2": 5 } },
  "contracts": { "total": 3, "byStatus": { "rascunho": 2, "aprovado": 1 } },
  "charges": { "total": 4, "byStatus": { "PENDING": 4 } }
}
```

Privacy: contagens apenas; sem valores monetários nem dados nominais.

### 4.3 Atividade recente — `GET /api/me/activity`

Auth: Bearer (escopo `metrics:r`) ou session.

Query: `?limit=N` (1-200, default 50), `?since=ISO8601` (opcional).

Response: `{ items: [{ id, action, result, resource, resourceType, metadata, createdAt }], count }`. Lê `AuditLog` filtrado por `userId` autenticado.

### 4.4 Sumário de contrato — `GET /api/contracts/[id]/summary`

Auth: Bearer (escopo `contracts:rw`) ou session. Cross-user guard via Bearer (apenas dono do contrato).

Response:
```json
{
  "contractId": "...",
  "dealId": "...",
  "status": "rascunho",
  "version": 1,
  "partes": { "vendedores": [{ "nome": "..." }], "compradores": [{ "nome": "..." }] },
  "valor": 500000,
  "ultimaAtualizacao": "...",
  "envelopeAtual": { "id": "...", "status": "running", "signedCount": 1, "totalSigners": 2 } | null,
  "markdown": "*Status:* Rascunho (versão 1)\n..."
}
```

NÃO chama LLM — extrai do `dataJson` + envelope mais recente. Determinístico, rápido, sem custo. Para análise jurídica profunda, usar `/api/contracts/[id]/auto-analyze` em separado.

Privacy: nomes nas partes vão na response (já públicos); CPF/RG NUNCA aparecem.

### 4.5 Saldo Infosimples — `GET /api/org/infosimples-budget`

Auth: Bearer (escopo `metrics:r`) ou session.

Response:
```json
{
  "orgId": "...",
  "month": "2026-05",
  "budgetCents": 5000000,
  "spentCents": 3500,
  "remainingCents": 4996500,
  "pct": 0.0007,
  "ok": true,
  "warningPct": 0.8,
  "spentByEndpoint": { "iptu": 2700, "matricula": 800 }
}
```

Budget vem de `INFOSIMPLES_MONTHLY_BUDGET_CENTS` env (default R$ 50.000).

### 4.6 Feed de eventos — `GET /api/events?since=ISO`

Para Newton consumir via polling (decisão #19: polling em vez de webhook outbound).

Auth: Bearer (escopo `metrics:r`) ou session.

Query:
- `since=ISO8601` **obrigatório** — cursor temporal, Newton mantém localmente.
- `limit` (1-500, default 100).
- `actions=ACTION1,ACTION2` (opcional) — filtra por subset de actions.

Response:
```json
{
  "events": [{ "id", "action", "result", "resource", "resourceType", "metadata", "createdAt", "userId" }],
  "count": 2,
  "nextSince": "2026-05-02T15:30:00.001Z"
}
```

`nextSince` = timestamp do último evento + 1ms. Quando não há eventos, `nextSince` = `since` original. Cliente persiste `nextSince` e usa na próxima chamada.

Filtro automático por `orgId` do usuário autenticado. Outras orgs nunca aparecem.

### 4.7 Propostas (2026-07-24)

Superfície completa via Bearer (escopo `proposals:rw`), com RBAC por proposta
(`canAccessProposal`: criador OU responsável atribuído) e feature gate
`vendas.propostas` / `locacao.propostas`. Espelhada 1:1 em tools MCP.

| Rota | HITL via Bearer? |
|---|---|
| `GET/POST /api/proposals` · `GET /{id}` · `GET /{id}/status` | — (leitura/rascunho) |
| `POST /{id}/send` | **sim** (`PROPOSAL_SEND`) — gasta orçamento ClickSign |
| `POST /{id}/send-vendedor` | **sim** (`PROPOSAL_SEND` com `via:"vendedor"`) |
| `POST /{id}/convert` | **sim** (`PROPOSAL_CONVERT`) — cria Deal |
| `POST /{id}/cancel` | **sim** (`PROPOSAL_CANCEL`) — destrói envelopes em curso |
| `POST /{id}/remind` · `POST /{id}/assignee` · `POST /{id}/sync` | não (baratos/reversíveis) |

Tools MCP: `list_proposals`, `get_proposal`, `get_proposal_status`,
`create_proposal`, `send_proposal`, `send_proposal_vendedor`, `convert_proposal`,
`cancel_proposal`, `remind_proposal`, `assign_proposal`, `sync_proposal`.

### 4.8 Twins de pipeline + certidões por job (2026-07-24)

Twins Bearer das rotas session-only de `/api/pipeline/deals/*` (padrão do
`mark-signed`): `POST /api/deals/{dealId}/mark-lost` (`deals:rw`), `.../reopen`
(`deals:rw`), `.../archive` (`deals:rw`), `.../generate-contract`
(`contracts:rw`). Sem HITL — todos reversíveis ou geram rascunho deletável.
**Não existe twin de `mark-commission-paid`**: o `mark-signed` já move pra
"Comissão paga" e seta `commissionPaidAt`.

Certidões (leitura, `documents:r`): `GET /api/deals/{dealId}/certidoes`
(?batchId) e `GET .../certidoes/{jobId}` (payload enxuto, sem `resultData`).
Dispatch continua HITL via `/certidoes-newton`; report/zip são session-only.

Tools MCP: `mark_deal_lost`, `reopen_deal`, `archive_deal`,
`generate_deal_contract`, `list_deal_certidoes`, `get_certidao_job`.

## 5. Auditoria

Toda ação de Newton precisa registrar em `AuditLog` com `metadata.via = "newton"`. Helper:

```ts
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { resolveNewtonActor, mergeAuditMetadata } from "@/lib/audit/newton";

const ident = await authOrBearer(req);
const actor = resolveNewtonActor(req, ident);
if (isRejection(actor)) return NextResponse.json({ error: actor.reason }, { status: 403 });

await audit(
  extractAuditContextFromRequest(req, orgId, actor.effectiveUserId),
  {
    action: "DEAL_CREATED", // exemplo
    result: "SUCCESS",
    resource: dealId,
    resourceType: "Deal",
    metadata: mergeAuditMetadata({ stage: "novo" }, actor),
  }
);
```

Actions Newton-específicas adicionadas em `src/lib/security/audit.ts`:

- `API_TOKEN_CREATED`
- `API_TOKEN_REVOKED`
- `API_TOKEN_AUTH_FAILED`
- `NEWTON_ACTOR_HEADER_REJECTED`

## 6. Migration

`prisma/migrations/20260503120000_add_newton_integration/migration.sql`:

- `User.phone` (String, unique, nullable) — E.164.
- `UserApiToken` — id, userId, name, hashedToken (sha256), scopes, lastUsedAt, expiresAt, revokedAt, createdAt.
- `IdempotencyKey` — userId+key composite unique, statusCode, responseBody (JSONB), responseHash, createdAt.

Rollback: `prisma/rollback/20260503120000_add_newton_integration_down.sql`. **APAGA dados** das tabelas novas — usar apenas se migration up causou problema imediato.

## 7. Próximos passos (Track A Fase 2 e 3)

### Fase 2 — endpoints faltantes

- [ ] `GET /api/users/me/metrics`
- [ ] `GET /api/users/me/activity` (lê `AuditLog`)
- [ ] `GET /api/contracts/{id}/summary` (reuso de lib `src/lib/ai/`)
- [ ] `GET /api/orgs/me/infosimples-budget` (agrega `CertidaoJob`)
- [ ] `GET /api/events?since=ISO` (lê `AuditLog`)

### Fase 3 — retrofit dos endpoints existentes

- [ ] Trocar `auth()` por `authOrBearer()` em handlers que Newton precisa chamar (deals, contracts, charges, etc.)
- [ ] Aplicar `withIdempotency()` em POST/PATCH/DELETE expostos a Bearer.
- [ ] Adicionar `ETag`/`If-Match` em handlers de leitura de recursos mutáveis (Contract, Deal, Charge).
- [ ] Detectar e auditar `via=newton` automaticamente via wrapper ou middleware.

### UI

- [ ] Página `/settings/api-tokens` para gerar/listar/revogar tokens. Mostrar `rawToken` em modal com botão copy + alerta de "salve agora".

## 8. Locação (Max) — 2026-07-24

Scopes novos `locacao:r` / `locacao:rw` (par por módulo; `rw ⊇ r`). Rate limits:
300/min (r), 60/min (rw). Granularidade fina vem do **RBAC do usuário dono do
token** (role de serviço do Max precisa de: `LEASE_VIEW`, `CLIENT_VIEW`,
`CLIENT_UPDATE`, `GUARANTEE_VIEW`, `GUARANTEE_MANAGE`, `INSURANCE_VIEW`,
`INSURANCE_MANAGE`, `INSPECTION_VIEW`, `RENT_VIEW`) + entitlement do módulo
locação do tenant. Helper: `ensureLocacaoApiAccess` em
`lib/locacao/route-helpers.ts` — aplicado só à allowlist abaixo; as demais
rotas `/api/locacao/*` continuam session-only.

**Leitura (`locacao:r`):** `GET /api/locacao/leases` (novo, filtros
status/propertyId/tenant) · `GET /api/locacao/leases/{id}` (novo; sem
repasseSplitJson) · `GET clients` + `clients/{id}` ·
`GET clients/{id}/insurer-analyses` · `GET guarantees` · `GET insurance` ·
`GET inspections` · `GET rent-charges` ·
`GET locacao/deals/{dealId}/insurance-newton?leaseContractId=`.

**Escrita (`locacao:rw`, direta com audit — registros reversíveis):**
`POST/PATCH clients/{id}/insurer-analyses` · `POST guarantees` +
`PATCH guarantees/{id}` · `POST insurance` + `PATCH insurance/{id}` ·
`POST locacao/deals/{dealId}/insurance-newton` (ramos incendio | fianca |
credito, idempotente por externalRef — canal preferido pros resultados do
max-fianca).

**Session-only (decisão):** `POST serasa-consent` (consentimento LGPD é ato
humano), `POST inspections` e `POST expenses` (fase futura, HITL
`INSPECTION_SCHEDULE` / `EXPENSE_CREATE_FROM_OCR` — executores já registrados),
`POST clients/{id}/credit-analysis` (dispara Serasa — custo), deletes.

**Tools MCP (grupo Max):** `list_lease_contracts`, `get_lease_contract`,
`list_lease_clients`, `get_lease_client`, `list_insurer_analyses`,
`list_lease_guarantees`, `list_insurance_policies`, `list_lease_inspections`,
`list_rent_charges`, `upsert_insurer_analysis`, `create_lease_guarantee`,
`update_lease_guarantee`, `create_insurance_policy` + os pré-existentes
`record_insurance_quote`, `get_deal_insurance`, `record_credit_analysis`.

## 9. Plano de controle dos agentes externos — 2026-07-31 (PR5)

Scopes `agents:r` / `agents:rw` (`rw ⊇ r`). São dois de propósito: `POST
/api/agents/usage` escreve numa tabela de **custo** que alimenta o teto mensal
por agente e o teto por contrato — quem só precisa ler a persona não deveria
poder mover o gasto da org.

Ambas as rotas são limitadas a agentes com `external: true` no registry
(`lib/ai/agents/registry.ts` — hoje só `max`). Um endpoint genérico entregaria
a um cliente externo o prompt de plataforma dos especialistas, que nem o dono do
tenant enxerga na UI, e deixaria um token reportar consumo como `editor`,
queimando o teto de um agente interno a partir de fora.

**`GET /api/agents/profile?agentKey=max`** (`agents:r`, 120/min) — devolve o
`AgentProfile` **resolvido** na cadeia org → plataforma → hardcoded, para a org
do dono do token: `enabled`, `model` + `modelSource`, `fallbackModel`,
`temperature`, `maxTokens`, `ragScope`, `budget` e `instructions`.

`instructions` vem em três partes: `platform`, `tenant` e `composed`. Use
`composed` — o texto do tenant precisa entrar dentro de
`<instrucoes_da_imobiliaria>` (é dado de terceiro, não autoridade capaz de
redefinir o agente), e entregar já cercado tira do runtime externo a chance de
esquecer a cerca.

`enabled: false` responde **200**, não 403 — é kill switch operacional sem
deploy, e quem chama precisa distinguir "desligado de propósito" de "não
consegui ler a configuração".

Sem org no dono do token: **403**. Cair no nível de plataforma devolveria uma
configuração que não é a de ninguém.

Ambas passam por `requireApiAuth` (`lib/api/require-auth.ts`), não por
`authOrBearer` cru: é ele que traz o rate limit por token+scope e a resolução de
org do caminho de máquina (`subdomainHint: null` em bearer). Sem esse pin, o
`Host` da request escolheria a org de um dono de token que é membro de vários
tenants — a persona sairia do errado e o custo cairia no errado.

`instructions.platform` do agente externo é legível por qualquer membro do
tenant (diferente do prompt dos especialistas, que a allowlist bloqueia). É
consequência do desenho, já que `composed` precisa conter o texto: nada de
segredo operacional ali.

**`POST /api/agents/usage`** (`agents:rw`, 60/min) — **só Bearer**. Sessão é
recusada com 403: `hasScope` considera todo escopo presente pra session-auth, e
esta é a única superfície em que um cliente escreve numa tabela de custo sem
guard a jusante — com signup aberto na org compartilhada, qualquer conta nova
inflaria `AIUsage` até estourar o teto e parar o chat de todos. O agente reporta o custo
do próprio turn, que entra em `AIUsage` com `agentKey` e aparece em
`/settings/ai-usage`. Sem isso o painel mente por omissão: o gasto do agente que
roda fora do repo não existiria no total.

Corpo: `agentKey`, `model`, `promptTokens`, `latencyMs` (obrigatórios) +
`provider`, `completionTokens`, `cacheReadTokens`, `cacheWriteTokens`,
`toolsUsed[]`, `iterations`, `success`, `errorMessage`, `contractId`, `dealId`.
Teto de 500k por campo de token: folgado sobre qualquer turn real (a janela dos
modelos é ~200k) e ainda assim contém o estrago, porque uma linha inflada
estoura sozinha o budget de 200k de um contrato.

O cliente **não** decide: `operation` vem do registry (`max_chat`); `orgId` e
`userId` vêm do token; o custo em dólar é calculado aqui pela tabela de preços —
custo informado por quem gasta não é medição. `contractId`/`dealId` de outra org
dão **403**, não descarte silencioso: `assertContractBudget` soma por
`contractId` sem olhar org, então aceitar id alheio deixaria um token estourar o
budget de outro tenant.

Resposta **202** (`recordAIUsage` é fire-and-forget por construção) com
`estimatedCostUsd` e `priced` — `priced: false` significa modelo fora da tabela
de preços, não turn de graça.
