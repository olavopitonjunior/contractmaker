/* eslint-disable no-console */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

extendZodWithOpenApi(z);

/**
 * Gera apps/web/public/openapi.json a partir dos Zod schemas + descrições
 * inline. Roda no prebuild (e via `npm run gen:openapi`).
 *
 * Cobertura: endpoints expostos a clientes externos (Newton, MCP, GPTs):
 *  - /api/me/{metrics,activity,api-tokens,intents}
 *  - /api/users/by-phone
 *  - /api/contracts/[id]/{summary,approve,comments,suggestions,envelopes}
 *  - /api/deals/[dealId]/{commission-charges,certidoes,route DELETE}
 *  - /api/forms (POST + GET)
 *  - /api/pipeline/deals (POST + GET)
 *  - /api/intents/[id], approve, reject
 *  - /api/events?since
 *  - /api/org/infosimples-budget
 */

const registry = new OpenAPIRegistry();

// ───────────────────────────────────────────────────────────────────────────
// Auth scheme
// ───────────────────────────────────────────────────────────────────────────

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "cmt_*",
  description:
    "Token de API gerado em /settings/api-tokens (prefixo cmt_). Hash sha256 armazenado server-side; exibido uma única vez na criação.",
});

// ───────────────────────────────────────────────────────────────────────────
// Common schemas
// ───────────────────────────────────────────────────────────────────────────

const ScopeEnum = z.enum([
  "deals:rw",
  "contracts:rw",
  "charges:rw",
  "signatures:rw",
  "documents:rw",
  "metrics:r",
]);

const ErrorResponse = z
  .object({
    error: z.string(),
    reason: z.string().optional(),
  })
  .openapi("ErrorResponse");

const IntentPendingResponse = z
  .object({
    intentId: z.string(),
    status: z.literal("pending"),
    approvalUrl: z.string(),
    expiresAt: z.string().datetime(),
    preview: z.object({
      summary: z.string(),
      details: z.record(z.unknown()),
    }),
    message: z.string(),
  })
  .openapi("IntentPendingResponse");

// ───────────────────────────────────────────────────────────────────────────
// /api/me/api-tokens
// ───────────────────────────────────────────────────────────────────────────

const ApiToken = z
  .object({
    id: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
    lastUsedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("ApiToken");

registry.registerPath({
  method: "get",
  path: "/api/me/api-tokens",
  description: "Lista tokens de API do usuário autenticado (sem rawToken).",
  tags: ["Tokens"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({ tokens: z.array(ApiToken) }),
        },
      },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/me/api-tokens",
  description:
    "Cria novo API token. **Session-only** (não aceita Bearer — token novo precisa de identidade humana). Retorna `rawToken` UMA VEZ.",
  tags: ["Tokens"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(100),
            scopes: z.array(ScopeEnum).min(1),
            expiresInDays: z.number().int().min(1).max(365).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: z.object({
            rawToken: z.string(),
            token: ApiToken,
            warning: z.string(),
          }),
        },
      },
    },
    400: { description: "Bad Request", content: { "application/json": { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/me/api-tokens/{id}",
  description: "Revoga API token. Idempotente.",
  tags: ["Tokens"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": { schema: z.object({ revoked: z.boolean() }) },
      },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/me/metrics, /api/me/activity, /api/me/intents
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/me/metrics",
  description:
    "Métricas agregadas do usuário (contagens deals/contratos/cobranças). Sem PII nem valores monetários.",
  tags: ["Me"],
  security: [{ bearerAuth: ["metrics:r"] }],
  request: {
    query: z.object({
      since: z.string().datetime().optional().describe("ISO8601, default: -30 dias"),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            since: z.string(),
            until: z.string(),
            deals: z.object({ total: z.number(), byStage: z.record(z.number()) }),
            contracts: z.object({ total: z.number(), byStatus: z.record(z.number()) }),
            charges: z.object({ total: z.number(), byStatus: z.record(z.number()) }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/me/activity",
  description: "Atividade recente do usuário lida do AuditLog.",
  tags: ["Me"],
  security: [{ bearerAuth: ["metrics:r"] }],
  request: {
    query: z.object({
      since: z.string().datetime().optional(),
      limit: z.string().optional().describe("1-200, default 50"),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                action: z.string(),
                result: z.string(),
                resource: z.string().nullable(),
                resourceType: z.string().nullable(),
                metadata: z.record(z.unknown()).nullable(),
                createdAt: z.string().datetime(),
              })
            ),
            count: z.number(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/me/intents",
  description: "Lista ActionIntents do usuário. Filtra por status.",
  tags: ["Intents"],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z
        .enum(["pending", "approved", "rejected", "executed", "expired", "failed"])
        .optional(),
      limit: z.string().optional().describe("1-100, default 50"),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                action: z.string(),
                status: z.string(),
                preview: z.record(z.unknown()),
                approvedAt: z.string().datetime().nullable(),
                executedAt: z.string().datetime().nullable(),
                expiresAt: z.string().datetime(),
                createdAt: z.string().datetime(),
              })
            ),
            count: z.number(),
          }),
        },
      },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/intents/[id]
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/intents/{id}",
  description: "Polling do status de uma ActionIntent. Inclui resultJson após executar.",
  tags: ["Intents"],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            action: z.string(),
            status: z.string(),
            preview: z.record(z.unknown()),
            approvedAt: z.string().datetime().nullable(),
            executedAt: z.string().datetime().nullable(),
            expiresAt: z.string().datetime(),
            rejectionReason: z.string().nullable(),
            result: z.record(z.unknown()).nullable(),
            errorMessage: z.string().nullable(),
            createdAt: z.string().datetime(),
          }),
        },
      },
    },
    404: { description: "Not Found" },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/users/by-phone
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/users/by-phone",
  description: "Lookup user por telefone E.164. Sem email (privacy).",
  tags: ["Users"],
  security: [{ bearerAuth: ["metrics:r"] }],
  request: {
    query: z.object({
      phone: z.string().describe("Formato E.164 (+5511987654321)"),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            userId: z.string(),
            orgId: z.string(),
            role: z.string(),
            name: z.string().nullable(),
          }),
        },
      },
    },
    404: { description: "Not Found" },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/contracts/[id]/summary
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/contracts/{id}/summary",
  description:
    "Sumário determinístico de contrato (sem LLM). Inclui markdown pronto pra exibir.",
  tags: ["Contracts"],
  security: [{ bearerAuth: ["contracts:rw"] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            contractId: z.string(),
            dealId: z.string().nullable(),
            status: z.string(),
            version: z.number(),
            partes: z.object({
              vendedores: z.array(z.object({ nome: z.string() })),
              compradores: z.array(z.object({ nome: z.string() })),
            }),
            valor: z.number().nullable(),
            ultimaAtualizacao: z.string().datetime(),
            envelopeAtual: z
              .object({
                id: z.string(),
                status: z.string(),
                signedCount: z.number(),
                totalSigners: z.number(),
              })
              .nullable(),
            markdown: z.string(),
          }),
        },
      },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/contracts/[id]/approve
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/contracts/{id}/approve",
  description:
    "Aprova contrato. Bearer → cria ActionIntent (HITL). Session → executa direto. Force=true ignora warnings (não bypassa erros).",
  tags: ["Contracts"],
  security: [{ bearerAuth: ["contracts:rw"] }],
  request: {
    params: z.object({ id: z.string() }),
    headers: z.object({
      "X-Idempotency-Key": z
        .string()
        .uuid()
        .optional()
        .describe("UUID v4 — uma key por intenção, TTL 24h"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            force: z.boolean().optional().default(false),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Aprovado (session) ou requiresReview com issues",
      content: {
        "application/json": {
          schema: z.union([
            z.object({ status: z.literal("aprovado") }),
            z.object({
              requiresReview: z.literal(true),
              canForce: z.boolean(),
              issues: z.array(z.unknown()),
              errorCount: z.number(),
              warningCount: z.number(),
              pendingSuggestions: z.number(),
              unresolvedComments: z.number(),
            }),
          ]),
        },
      },
    },
    202: {
      description: "Bearer: intent pending",
      content: { "application/json": { schema: IntentPendingResponse } },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/deals/[dealId]/commission-charges
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/deals/{dealId}/commission-charges",
  description:
    "Cria cobrança de comissão Asaas. Bearer → ActionIntent (HITL). Session → executa direto.",
  tags: ["Charges"],
  security: [{ bearerAuth: ["charges:rw"] }],
  request: {
    params: z.object({ dealId: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            billingType: z.enum(["PIX", "BOLETO"]),
            dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            contractId: z.string().optional(),
            description: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Criado (session)" },
    202: {
      description: "Bearer: intent pending",
      content: { "application/json": { schema: IntentPendingResponse } },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/contracts/[id]/envelopes
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/contracts/{id}/envelopes",
  description:
    "Envia contrato pra assinatura ClickSign. Bearer → ActionIntent (HITL). Session → executa direto.",
  tags: ["Signatures"],
  security: [{ bearerAuth: ["signatures:rw"] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            authMethod: z
              .enum(["email", "whatsapp", "selfie", "icp_brasil"])
              .optional(),
            envelopeName: z.string().min(1).max(200).optional(),
            deadlineAt: z.string().datetime().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Criado (session)" },
    202: {
      description: "Bearer: intent pending",
      content: { "application/json": { schema: IntentPendingResponse } },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/events
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/events",
  description:
    "Feed de eventos pra polling (Newton). Lê AuditLog filtrado pela org. Cliente persiste `nextSince` pra próxima chamada.",
  tags: ["Events"],
  security: [{ bearerAuth: ["metrics:r"] }],
  request: {
    query: z.object({
      since: z.string().datetime().describe("ISO8601 obrigatório"),
      limit: z.string().optional().describe("1-500, default 100"),
      actions: z
        .string()
        .optional()
        .describe("CSV de actions a filtrar"),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(
              z.object({
                id: z.string(),
                action: z.string(),
                result: z.string(),
                resource: z.string().nullable(),
                resourceType: z.string().nullable(),
                metadata: z.record(z.unknown()).nullable(),
                createdAt: z.string().datetime(),
                userId: z.string().nullable(),
              })
            ),
            count: z.number(),
            nextSince: z.string().datetime(),
          }),
        },
      },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/org/infosimples-budget
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/org/infosimples-budget",
  description: "Saldo mensal Infosimples (certidões) da org.",
  tags: ["Org"],
  security: [{ bearerAuth: ["metrics:r"] }],
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({
            orgId: z.string(),
            month: z.string(),
            budgetCents: z.number(),
            spentCents: z.number(),
            remainingCents: z.number(),
            pct: z.number(),
            ok: z.boolean(),
            warningPct: z.number(),
            spentByEndpoint: z.record(z.number()),
          }),
        },
      },
    },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/deals/[dealId]  — PATCH (stage move / rename)
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "patch",
  path: "/api/deals/{dealId}",
  description:
    "Atualiza stage e/ou título de um deal. Reversível (sem HITL): outro PATCH com stageId anterior desfaz. stageId precisa pertencer ao mesmo pipeline do deal.",
  tags: ["Deals"],
  security: [{ bearerAuth: ["deals:rw"] }],
  request: {
    params: z.object({ dealId: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            stageId: z.string().optional(),
            title: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Atualizado",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            title: z.string(),
            stageId: z.string(),
            stage: z.object({ id: z.string(), name: z.string() }),
            updatedAt: z.string().datetime(),
          }),
        },
      },
    },
    400: { description: "Body vazio ou stageId fora do pipeline" },
    403: { description: "Cross-org ou cross-user (Bearer)" },
    404: { description: "Deal não encontrado" },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/deals/[dealId]/mark-signed
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/deals/{dealId}/mark-signed",
  description:
    "Atalho: move deal de stage 'Assinatura' para 'Concluído'. Falha se não estiver em 'Assinatura'. Reversível via PATCH stageId.",
  tags: ["Deals"],
  security: [{ bearerAuth: ["deals:rw"] }],
  request: { params: z.object({ dealId: z.string() }) },
  responses: {
    200: {
      description: "Concluído",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("concluido"),
            dealId: z.string(),
            stageId: z.string(),
            stageName: z.string(),
          }),
        },
      },
    },
    400: { description: "Deal não está em 'Assinatura'" },
    404: { description: "Deal não encontrado" },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/contracts/[id]/status
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "patch",
  path: "/api/contracts/{id}/status",
  description:
    "Move contrato entre 'rascunho' e 'review' (reversível, sem HITL). Para 'aprovado' use /approve (HITL). Bloqueia 409 se contrato já está aprovado.",
  tags: ["Contracts"],
  security: [{ bearerAuth: ["contracts:rw"] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            status: z.enum(["rascunho", "review"]),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Atualizado",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            status: z.string(),
            updatedAt: z.string().datetime(),
          }),
        },
      },
    },
    400: { description: "Status inválido" },
    409: { description: "Contrato aprovado não pode mudar status por aqui" },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/deals/[dealId]/certidoes-newton  (HITL)
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/deals/{dealId}/certidoes-newton",
  description:
    "Solicita batch de certidões Infosimples. SEMPRE HITL — Bearer cria ActionIntent CERTIDAO_REQUEST (custo Infosimples; humano aprova em /intents/<id>). Auto-plan: o servidor decide quais certidões emitir baseado nos dados do deal/diligenciados. Cliente gera batchId (UUID v4) upfront pra idempotência.",
  tags: ["Certidoes"],
  security: [{ bearerAuth: ["deals:rw"] }],
  request: {
    params: z.object({ dealId: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            batchId: z.string().uuid(),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: "Bearer: intent pending OU batch dispatched",
      content: {
        "application/json": {
          schema: z.union([
            IntentPendingResponse,
            z.object({
              batchId: z.string(),
              jobCount: z.number(),
              skipped: z.array(z.unknown()),
              totalCostCents: z.number(),
            }),
          ]),
        },
      },
    },
    400: { description: "Sem certidões disponíveis pro deal" },
    402: { description: "Budget mensal estourado" },
    409: { description: "Batch ativo recente (< 30min)" },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// /api/deals/[dealId]/attachments-newton
// ───────────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/deals/{dealId}/attachments-newton",
  description:
    "Sobe um documento (PDF/JPG/PNG/WebP/GIF) pra um deal via JSON com base64 (não multipart — Bearer-friendly). Limite 10MB. Sem HITL — reversível via DELETE no attachment.",
  tags: ["Documents"],
  security: [{ bearerAuth: ["documents:rw"] }],
  request: {
    params: z.object({ dealId: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            filename: z.string().min(1).max(255),
            mime: z.enum([
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "application/pdf",
            ]),
            base64Data: z.string().min(1),
            category: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Attachment criado",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            filename: z.string(),
            mime: z.string(),
            url: z.string(),
            category: z.string().nullable(),
            createdAt: z.string().datetime(),
          }),
        },
      },
    },
    400: { description: "Mime inválido / base64 vazio / size > 10MB" },
    503: { description: "BLOB_READ_WRITE_TOKEN não configurado no servidor" },
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Generate
// ───────────────────────────────────────────────────────────────────────────

const generator = new OpenApiGeneratorV31(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "Contractmaker API (Newton-compatible)",
    version: "1.0.0",
    description: `API REST do Contractmaker para integração com agentes de IA externos
(Newton WhatsApp, Claude Desktop via MCP, ChatGPT GPTs).

Auth: Bearer token gerado em \`/settings/api-tokens\`. Headers obrigatórios:
- \`Authorization: Bearer cmt_<token>\`
- \`X-Idempotency-Key: <uuid-v4>\` (para POST/PATCH/DELETE)

Ações high-risk (CHARGE_CREATE, ENVELOPE_SEND, CONTRACT_APPROVE, DEAL_DELETE_HARD)
retornam 202 + intentId quando chamadas via Bearer; humano aprova em
\`/intents/<id>\` antes da execução.

Documentação completa: docs/newton-integration.md`,
  },
  servers: [
    {
      url: "https://imobpro.ia.br",
      description: "Production",
    },
    {
      url: "http://localhost:3000",
      description: "Local dev",
    },
  ],
});

const outDir = path.join(process.cwd(), "public");
const outFile = path.join(outDir, "openapi.json");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(document, null, 2) + "\n", "utf8");

console.log(`✓ OpenAPI 3.1 spec gerado em ${outFile}`);
console.log(
  `  ${Object.keys(document.paths ?? {}).length} paths, ${
    Object.keys((document.components as { schemas?: Record<string, unknown> })?.schemas ?? {}).length
  } schemas`
);
