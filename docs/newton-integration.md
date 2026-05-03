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

Scope check: handlers chamam `hasScope(ident, "...")`. Para auth via session, todos os scopes são considerados presentes.

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

### 4.2 Outros endpoints planejados (Track A Fase 2)

Ainda não implementados — documentar quando chegarem:

- `GET /api/users/me/metrics`
- `GET /api/users/me/activity`
- `GET /api/contracts/{id}/summary`
- `GET /api/orgs/me/infosimples-budget`
- `GET /api/events?since=ISO&limit=N` (para polling de eventos contractmaker→Newton)

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
