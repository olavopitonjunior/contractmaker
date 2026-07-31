import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// ANTHROPIC_API_KEY precisa estar setada antes do import de agent.ts —
// `getAnthropicClient()` faz early-throw se vazia (mesmo com SDK mockado).
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret";

// --- Prisma mock ---
vi.mock("@/lib/db/prisma", () => {
  // Reference que vai ser preenchida abaixo — permite $transaction passar
  // o próprio mock como tx ao callback.
  const prismaMock: Record<string, unknown> = {};
  const mock = {
    contract: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    clause: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    // Pós-unificação 2026-05-18 — biblioteca de cláusulas vive aqui
    // (category="clause"). Clause acima fica até PR follow-up que dropa o model.
    knowledgeItem: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      // Arquivamento em lote — usado pela reingestão de cláusulas de slot
      // (POST /api/templates/ingest/clauses).
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
      // Remoção escopada (`deleteKnowledgeItem`) — o `where` carrega o filtro de
      // org/categoria que impede escrita fora do escopo, então os testes precisam
      // conseguir inspecionar a chamada.
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    contractTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    orgGoogleAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    clickSignAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    orgSignatureSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    defaultWitness: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    orgFormSettings: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    orgInvitation: {
      count: vi.fn().mockResolvedValue(0),
    },
    // Catálogo de garantias locatícias (tipo × garantidor). Vazio por padrão =
    // org cai nos defaults em código, que é o caminho da maioria dos testes.
    garantiaOption: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contractClause: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    contractChangeLog: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    chatSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    chatMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(),
    },
    agentConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    platformAgentDefaults: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    // Fonte única de config de agente desde o AgentProfile. Default null nos
    // dois níveis = cai no hardcoded do registry, que é o que a maioria dos
    // testes espera.
    agentProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    formAttachment: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    dealAttachment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // Arquivo permanente de anexos excluídos. `count` default 0 pro
    // ref-check de blob; `create` devolve id pra archiveAttachment.
    deletedAttachment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "archived-mock" }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    diligentedPerson: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    contractSuggestion: {
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    contractComment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Newton — integração externa
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    userApiToken: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    idempotencyKey: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    orgMembership: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      // requireAuth (context.ts) atualiza lastActiveAt em fire-and-forget.
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      // getEffectivePermissions (feature Gerente): default owner = visão
      // org-wide, preservando o status quo dos testes pré-feature. Testes de
      // escopo restrito sobrepõem com role "gerente".
      findUnique: vi
        .fn()
        .mockResolvedValue({ role: "owner", customRole: null }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    platformRole: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    platformConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    orgFinancialSettings: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    asaasAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    deal: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    newtonRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    surveyInvite: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    dealGroupLink: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
    whatsappGroup: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    whatsappGroupMember: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
    notification: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Canal externo das notificações do sistema → usuário (2026-07)
    userNotificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    userNotificationDelivery: {
      create: vi.fn().mockResolvedValue({ id: "delivery-mock" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    // Notificações do processo → corretores (2026-07)
    orgNotificationSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    // Gerente do negócio (2026-07) — row ausente = defaults (toggle off)
    orgManagerSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    dealNotificationLog: {
      create: vi.fn().mockResolvedValue({ id: "log-mock" }),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Fallback relacional das partes de locação (lib/deals/parties.ts)
    leaseContract: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Link público /pay/[token] — lido (nunca cunhado) pelo aviso à parte
    chargePublicLink: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    splitRecipient: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    // Criação de tenant (POST /api/admin/orgs) — 1:1 com a org.
    brandingSettings: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    orgModule: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    pipeline: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "pipe-mock" }),
    },
    pipelineStage: {
      findFirst: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    salesForm: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    salesFormParticipant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(async (cb: never) =>
      typeof cb === "function"
        ? (cb as (tx: unknown) => unknown)(prismaMock)
        : cb
    ),
    // Raw SQL (pgvector, agregações do funil) — default vazio; testes que
    // precisam de rows fazem mockResolvedValue no próprio caso.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    commissionCharge: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    certidaoJob: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    actionIntent: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    apiUsage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    aIUsage: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
      }),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    envelope: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    envelopeSigner: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    envelopeEvent: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Documentos do envelope (contrato + laudo de vistoria no mesmo envelope).
    // Default vazio = envelope de documento único / legado.
    envelopeDocument: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    inspection: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    proposal: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    proposalEvent: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    proposalSigner: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    proposalAttachment: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  Object.assign(prismaMock, mock);
  return { prisma: mock };
});

// --- Anthropic SDK mock ---
vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn();
  function MockAnthropic() {
    return { messages: { create } };
  }
  MockAnthropic.prototype = {};
  return {
    Anthropic: MockAnthropic,
    default: MockAnthropic,
  };
});

// --- Auth mock ---
vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
  getUserOrg: vi.fn(),
}));

// --- Handlebars render mock ---
vi.mock("@/lib/render/handlebars", () => ({
  renderContratoHTML: vi.fn(
    (_template: string, data: Record<string, unknown>) =>
      `<rendered>${JSON.stringify(data)}</rendered>`
  ),
}));

// --- Validation schemas mock ---
vi.mock("@/lib/validation/schemas", async () => {
  const { z } = await import("zod");
  return {
    chatSchema: z.object({
      message: z.string().min(1),
      mode: z.enum(["fast", "plan"]).default("plan"),
      sessionId: z.string().optional(),
      attachmentIds: z.array(z.string()).optional(),
    }),
    // Newton — schemas reais (sem mock) para tests novos
    apiTokenCreateSchema: z.object({
      name: z.string().min(1).max(100),
      scopes: z
        .array(
          z.enum([
            "deals:rw",
            "contracts:rw",
            "charges:rw",
            "signatures:rw",
            "documents:rw",
            "metrics:r",
          ])
        )
        .min(1),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }),
    phoneE164Schema: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, "phone must be E.164 (e.g. +5511987654321)"),
  };
});
