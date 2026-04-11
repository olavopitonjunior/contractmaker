import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PUT } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/settings/agent", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 400 when user has no org", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockGetUserOrg.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("returns existing config when found", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockGetUserOrg.mockResolvedValueOnce(createMockOrg());
    mockPrisma.agentConfig.findUnique.mockResolvedValueOnce({
      model: "claude-opus-4-20250514",
      temperature: 0.5,
      maxTokens: 8192,
      systemPrompt: "Custom",
    } as any);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.model).toBe("claude-opus-4-20250514");
    expect(json.temperature).toBe(0.5);
  });

  it("returns defaults when no config exists", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockGetUserOrg.mockResolvedValueOnce(createMockOrg());
    mockPrisma.agentConfig.findUnique.mockResolvedValueOnce(null);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.model).toBe("claude-sonnet-4-20250514");
    expect(json.temperature).toBe(0.3);
    expect(json.maxTokens).toBe(4096);
  });
});

describe("PUT /api/settings/agent", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const req = new NextRequest("http://localhost/api/settings/agent", {
      method: "PUT",
      body: JSON.stringify({ model: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("upserts config with body values", async () => {
    mockAuth.mockResolvedValueOnce(createMockSession());
    mockGetUserOrg.mockResolvedValueOnce(createMockOrg({ id: "org-1" }));
    mockPrisma.agentConfig.upsert.mockResolvedValueOnce({
      model: "claude-opus-4-20250514",
      temperature: 0.7,
    } as any);

    const req = new NextRequest("http://localhost/api/settings/agent", {
      method: "PUT",
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        temperature: 0.7,
        maxTokens: 6000,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(mockPrisma.agentConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1" },
        update: expect.objectContaining({
          model: "claude-opus-4-20250514",
          temperature: 0.7,
          maxTokens: 6000,
        }),
        create: expect.objectContaining({
          orgId: "org-1",
          model: "claude-opus-4-20250514",
        }),
      })
    );
  });
});
