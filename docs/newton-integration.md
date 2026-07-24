# Newton — Integration surface

> Documentação para consumidores externos que vão chamar a API do contractmaker em nome de um usuário (hoje: agente Newton via WhatsApp). Vivo conforme `apps/web/src/lib/auth/api-token.ts`, `auth-or-bearer.ts`, `audit/newton.ts`, `api/idempotency.ts`. Atualizar quando essas libs mudarem.

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
| `GET/PUT /api/deals/[dealId]/commission-charges/draft` | `charges:rw` |
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
