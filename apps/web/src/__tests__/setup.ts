import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// --- Prisma mock ---
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    contract: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    clause: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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
      create: vi.fn(),
    },
    chatMessage: {
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
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

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
    chatSchema: z.object({ message: z.string().min(1) }),
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
