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
  };
});
