import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  contractBelongsToOrg,
  attachmentBelongsToOrg,
  getContractOrgId,
  resolveUserOrgId,
  requireOrgAdmin,
} from "../org-scope";
import { getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getContractOrgId", () => {
  it("resolve orgId via deal.pipeline", async () => {
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      deal: { pipeline: { orgId: "org-A" } },
    } as any);
    expect(await getContractOrgId("c1")).toBe("org-A");
  });

  it("retorna null quando contrato não existe", async () => {
    mockPrisma.contract.findUnique.mockResolvedValueOnce(null);
    expect(await getContractOrgId("c1")).toBeNull();
  });
});

describe("contractBelongsToOrg", () => {
  it("true quando orgs batem", async () => {
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      deal: { pipeline: { orgId: "org-A" } },
    } as any);
    expect(await contractBelongsToOrg("c1", "org-A")).toBe(true);
  });

  it("false cross-org", async () => {
    mockPrisma.contract.findUnique.mockResolvedValueOnce({
      deal: { pipeline: { orgId: "org-B" } },
    } as any);
    expect(await contractBelongsToOrg("c1", "org-A")).toBe(false);
  });

  it("false (deny-by-default) sem orgId do usuário — nem consulta o banco", async () => {
    expect(await contractBelongsToOrg("c1", null)).toBe(false);
    expect(await contractBelongsToOrg("c1", undefined)).toBe(false);
    expect(mockPrisma.contract.findUnique).not.toHaveBeenCalled();
  });

  it("false quando contrato não existe", async () => {
    mockPrisma.contract.findUnique.mockResolvedValueOnce(null);
    expect(await contractBelongsToOrg("c1", "org-A")).toBe(false);
  });
});

describe("attachmentBelongsToOrg", () => {
  it("true quando orgs batem", async () => {
    mockPrisma.dealAttachment.findUnique.mockResolvedValueOnce({
      deal: { pipeline: { orgId: "org-A" } },
    } as any);
    expect(await attachmentBelongsToOrg("a1", "org-A")).toBe(true);
  });

  it("false cross-org", async () => {
    mockPrisma.dealAttachment.findUnique.mockResolvedValueOnce({
      deal: { pipeline: { orgId: "org-B" } },
    } as any);
    expect(await attachmentBelongsToOrg("a1", "org-A")).toBe(false);
  });
});

describe("resolveUserOrgId", () => {
  it("retorna id da org", async () => {
    mockGetUserOrg.mockResolvedValueOnce({ id: "org-A" } as any);
    expect(await resolveUserOrgId("u1")).toBe("org-A");
  });

  it("null quando getUserOrg lança", async () => {
    mockGetUserOrg.mockRejectedValueOnce(new Error("db down"));
    expect(await resolveUserOrgId("u1")).toBeNull();
  });

  it("null quando user não tem org", async () => {
    mockGetUserOrg.mockResolvedValueOnce(null as any);
    expect(await resolveUserOrgId("u1")).toBeNull();
  });
});

describe("requireOrgAdmin", () => {
  it("401 sem userId", async () => {
    const r = await requireOrgAdmin(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(401);
  });

  it("403 sem org", async () => {
    mockGetUserOrg.mockResolvedValueOnce(null as any);
    const r = await requireOrgAdmin("u1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it("403 pra member comum", async () => {
    mockGetUserOrg.mockResolvedValueOnce({ id: "org-A" } as any);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce({
      role: "member",
    } as any);
    const r = await requireOrgAdmin("u1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(403);
  });

  it("ok pra owner", async () => {
    mockGetUserOrg.mockResolvedValueOnce({ id: "org-A" } as any);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce({
      role: "owner",
    } as any);
    const r = await requireOrgAdmin("u1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.orgId).toBe("org-A");
  });

  it("ok pra impersonation (sem membership na org impersonada)", async () => {
    mockGetUserOrg.mockResolvedValueOnce({ id: "org-B" } as any);
    mockPrisma.orgMembership.findFirst.mockResolvedValueOnce(null);
    const r = await requireOrgAdmin("super-admin");
    expect(r.ok).toBe(true);
  });
});
