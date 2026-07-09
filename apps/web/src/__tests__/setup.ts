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
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    contractTemplate: {
      findMany: vi.fn(),
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
    formAttachment: {
      findUnique: vi.fn(),
    },
    dealAttachment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
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
      // requireAuth (context.ts) atualiza lastActiveAt em fire-and-forget.
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    newtonRequest: {
      findUnique: vi.fn(),
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
      findMany: vi.fn().mockResolvedValue([]),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    orgModule: {
      findMany: vi.fn().mockResolvedValue([]),
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
    $transaction: vi.fn(async (cb: never) =>
      typeof cb === "function"
        ? (cb as (tx: unknown) => unknown)(prismaMock)
        : cb
    ),
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
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
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
