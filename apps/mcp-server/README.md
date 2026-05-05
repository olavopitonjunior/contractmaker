# Contractmaker MCP Server

Bridge entre clientes MCP (Claude Desktop, n8n, etc.) e a API REST do Contractmaker.

## Instalação local

```bash
cd apps/mcp-server
npm install
npm run build
```

## Configuração

### Claude Desktop

Edite `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "contractmaker": {
      "command": "node",
      "args": ["/caminho/para/Contractmaker/apps/mcp-server/dist/index.js"],
      "env": {
        "CONTRACTMAKER_API_URL": "https://imobpro.ia.br",
        "CONTRACTMAKER_API_TOKEN": "cmt_..."
      }
    }
  }
}
```

Token obtido em https://imobpro.ia.br/settings/api-tokens.

### ChatGPT GPTs

Use OpenAPI spec direto (mais simples que MCP nesse caso):
- URL: `https://imobpro.ia.br/api/openapi.json`
- Auth: Bearer token

## Tools disponíveis

| Tool | Descrição |
|---|---|
| `get_my_metrics` | Contagens de deals/contratos/cobranças |
| `get_my_activity` | Últimos eventos do AuditLog do usuário |
| `get_events` | Polling de eventos da org (since/limit/actions) |
| `lookup_user_by_phone` | Mapping WhatsApp → user |
| `get_contract_summary` | Sumário determinístico de contrato |
| `get_infosimples_budget` | Saldo mensal certidões |
| `list_pending_intents` | ActionIntents aguardando aprovação |
| `get_intent_status` | Polling status de intent |
| `approve_contract` | Aprovar contrato (gera intent HITL) |
| `create_commission_charge` | Criar cobrança Asaas (intent HITL) |
| `send_envelope` | Enviar pra ClickSign (intent HITL) |
| `list_envelopes` | Listar envelopes de contrato |

## Human-in-the-Loop

Ações high-risk (`approve_contract`, `create_commission_charge`, `send_envelope`) **não executam direto** quando chamadas via MCP. Em vez disso, criam uma `ActionIntent` que precisa ser aprovada por um humano em https://imobpro.ia.br/intents/<id>.

O cliente MCP recebe `{ status: "pending", intentId, approvalUrl }`. Pode usar `get_intent_status` pra polling até `status === "executed"`.

## Idempotência

Endpoints de escrita aceitam `idempotencyKey` (UUID v4). Mesmo retry com mesma key dentro de 24h retorna a mesma resposta. Use sempre que rodar uma ação retryable.

## Desenvolvimento

```bash
npm run dev   # tsx watch mode
npm run build # tsc
```
