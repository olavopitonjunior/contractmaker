# MCP setup — Contractmaker via Claude Desktop / GPTs / n8n

## Pré-requisitos

1. Token de API gerado em https://imobpro.ia.br/settings/api-tokens
2. Scopes mínimos depende do uso:
   - Leitura: `metrics:r`, `contracts:rw` (pra summary)
   - Aprovar contratos / criar cobranças / enviar envelopes: `contracts:rw`, `charges:rw`, `signatures:rw`

## Claude Desktop

Edite `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "contractmaker": {
      "command": "node",
      "args": [
        "/caminho/absoluto/para/Contractmaker/apps/mcp-server/dist/index.js"
      ],
      "env": {
        "CONTRACTMAKER_API_URL": "https://imobpro.ia.br",
        "CONTRACTMAKER_API_TOKEN": "cmt_..."
      }
    }
  }
}
```

Restart Claude Desktop. As tools aparecem no menu (martelo) com prefixo `mcp__contractmaker__`.

### Build do server

```bash
cd apps/mcp-server
npm install
npm run build
```

## ChatGPT GPTs (mais simples que MCP)

Em vez de instalar o MCP server, importe o spec OpenAPI direto:

1. Configure o GPT com Action
2. URL do spec: `https://imobpro.ia.br/api/openapi.json`
3. Auth: HTTP Bearer (token `cmt_...`)
4. ChatGPT lê os 13 endpoints e gera tools automaticamente

## n8n

Use HTTP Request node:
- URL: `https://imobpro.ia.br/api/...`
- Headers: `Authorization: Bearer cmt_...`, `X-Idempotency-Key: {{ $execution.id }}`
- Body conforme OpenAPI spec

## Fluxo HITL (Human-in-the-Loop)

Ações de risco — `approve_contract`, `create_commission_charge`, `send_envelope` — **não executam direto** via Bearer:

1. Cliente MCP/GPT chama o endpoint
2. Servidor responde 202 com `{ intentId, approvalUrl, expiresAt, preview }`
3. Humano abre `https://imobpro.ia.br/intents/<id>` no browser
4. Revisa preview (custo, signers, taxas) e clica Aprovar
5. Servidor executa internamente e marca intent como `executed` + `resultJson`
6. Cliente faz polling em `get_intent_status({ intentId })` até `status === "executed"`

TTL: 24h. Sem aprovação → status vira `expired`.

## Tools com Bearer auth (sem HITL)

Tools de leitura + ações low-risk executam imediatamente:
- `get_my_metrics`, `get_my_activity`, `get_events` (polling — para automações)
- `get_contract_summary`, `lookup_user_by_phone`, `get_infosimples_budget`
- `list_envelopes`, `list_pending_intents`, `get_intent_status`

## Grupos de tools (2026-07-24 — 80 tools no server)

Inventário completo em `apps/mcp-server/src/tools.ts`; superfície REST em
`docs/newton-integration.md` (§4.7 Propostas, §4.8 pipeline/certidões, §8 Locação).

- **Propostas** (`proposals:rw`): 11 tools; `send/send_vendedor/convert/cancel`
  são HITL (202 → aprovação em `/intents/<id>`).
- **Pipeline twins** (`deals:rw`/`contracts:rw`): `mark_deal_lost`, `reopen_deal`,
  `archive_deal`, `generate_deal_contract` — sem HITL (reversíveis).
- **Certidões (leitura)** (`documents:r`): `list_deal_certidoes`, `get_certidao_job`.
- **Locação — Max** (`locacao:r`/`locacao:rw`): 16 tools (leitura da carteira +
  registro de análises/garantias/apólices; `record_insurance_quote` idempotente
  por `externalRef` é o canal preferido pros resultados de fiança).

Regra desde 2026-07-24: **Bearer só entra em rota com scope declarado** — rota
session-only responde 403 `bearer_on_unscoped_route`.

## Rate limits

Per-token, sliding window 1min:
- `metrics:r`: 600 req/min (polling-friendly)
- `locacao:r`: 300 req/min
- `locacao:rw`: 60 req/min
- `documents:rw` (certidões): 30 req/min
- Demais: 100 req/min

429 retorna `Retry-After` header em segundos.

## Observabilidade

Cada chamada é registrada em `ApiUsage`:
- Dashboard: `https://imobpro.ia.br/settings/api-usage`
- Métricas: total calls, error rate, p50/p95 latency, top endpoints, top tokens

Eventos relevantes em `AuditLog` (incl. `INTENT_*`):
- API: `GET /api/events?since=ISO&limit=N&actions=ACTION1,ACTION2`
- Newton consome via polling (decisão arquitetural #19)

## Troubleshooting

- **401 Unauthorized**: token revogado/inválido. Gerar novo em /settings/api-tokens.
- **403 Forbidden + missing scope**: token não tem o scope necessário. Recriar com scope correto.
- **403 + NEWTON_ACTOR_HEADER_REJECTED**: tentando spoofar header `X-Newton-Actor`. Não enviar — token já carrega userId.
- **429 RATE_LIMITED**: aguardar `Retry-After`s segundos.
- **412 Precondition Failed**: ETag mismatch. Cliente leu versão velha do recurso. Fazer GET novamente antes de PATCH.
- **Intent expirou (410 Gone)**: 24h sem aprovação. Refazer chamada original.
