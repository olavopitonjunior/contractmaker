import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPermissionsCreate = vi.fn();
const mockPermissionsList = vi.fn();
const mockPermissionsUpdate = vi.fn();
const mockGetOwnerDriveClient = vi.fn(() => ({
  permissions: {
    create: mockPermissionsCreate,
    list: mockPermissionsList,
    update: mockPermissionsUpdate,
  },
}));
const mockGetServiceAccountEmail = vi.fn();
const mockIsOwnerOAuthConfigured = vi.fn();
const mockEnvTrim = vi.fn();

const mockFindMany = vi.fn();

vi.mock("../client", () => ({
  getOwnerDriveClient: mockGetOwnerDriveClient,
  getServiceAccountEmail: mockGetServiceAccountEmail,
  isOwnerOAuthConfigured: mockIsOwnerOAuthConfigured,
  envTrim: mockEnvTrim,
}));

// Seam multitenant: orgs sem conta Google conectada resolvem pra credencial
// global — devolvemos o mesmo drive mockado dos asserts originais.
vi.mock("../org-oauth", () => ({
  resolveOwnerAuth: vi.fn(async () => ({ auth: {}, source: "global" })),
  getOwnerDriveForAuth: () => mockGetOwnerDriveClient(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    orgMembership: {
      findMany: mockFindMany,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsOwnerOAuthConfigured.mockReturnValue(true);
  mockGetServiceAccountEmail.mockReturnValue("sa@example.iam.gserviceaccount.com");
  mockEnvTrim.mockImplementation((name: string) =>
    name === "GOOGLE_OWNER_EMAIL" ? "olavo@example.com" : undefined
  );
  mockPermissionsCreate.mockResolvedValue({});
  mockPermissionsList.mockResolvedValue({ data: { permissions: [] } });
  mockPermissionsUpdate.mockResolvedValue({});
});

describe("shareDocWithOrgMembers", () => {
  it("retorna vazio quando owner OAuth não configurado", async () => {
    mockIsOwnerOAuthConfigured.mockReturnValue(false);
    const { shareDocWithOrgMembers } = await import("../share-org");
    const result = await shareDocWithOrgMembers("doc-1", "org-1");
    expect(result).toEqual({ shared: [], skipped: [], failed: [] });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
  });

  it("exclui owner, SA, e emails vazios; compartilha apenas humanos restantes", async () => {
    mockFindMany.mockResolvedValue([
      { user: { email: "olavo@example.com" } },
      { user: { email: "sa@example.iam.gserviceaccount.com" } },
      { user: { email: "marcia@example.com" } },
      { user: { email: "  " } },
      { user: { email: null } },
      { user: { email: "joao@example.com" } },
    ]);
    const { shareDocWithOrgMembers } = await import("../share-org");
    const result = await shareDocWithOrgMembers("doc-1", "org-1");

    expect(mockPermissionsCreate).toHaveBeenCalledTimes(2);
    const emails = mockPermissionsCreate.mock.calls.map(
      (c) => c[0].requestBody.emailAddress
    );
    expect(emails).toContain("marcia@example.com");
    expect(emails).toContain("joao@example.com");
    expect(emails).not.toContain("olavo@example.com");
    expect(emails).not.toContain("sa@example.iam.gserviceaccount.com");

    expect(result.shared.sort()).toEqual([
      "joao@example.com",
      "marcia@example.com",
    ]);
    expect(result.skipped).toContain("olavo@example.com");
    expect(result.skipped).toContain("sa@example.iam.gserviceaccount.com");
  });

  it("usa role=writer e sendNotificationEmail=false", async () => {
    mockFindMany.mockResolvedValue([
      { user: { email: "marcia@example.com" } },
    ]);
    const { shareDocWithOrgMembers } = await import("../share-org");
    await shareDocWithOrgMembers("doc-xyz", "org-1");
    expect(mockPermissionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "doc-xyz",
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress: "marcia@example.com",
        },
        sendNotificationEmail: false,
        supportsAllDrives: true,
      })
    );
  });

  it("comparação de email é case-insensitive contra owner/SA", async () => {
    mockEnvTrim.mockImplementation((name: string) =>
      name === "GOOGLE_OWNER_EMAIL" ? "Olavo@Example.com" : undefined
    );
    mockFindMany.mockResolvedValue([
      { user: { email: "OLAVO@example.com" } },
      { user: { email: "marcia@example.com" } },
    ]);
    const { shareDocWithOrgMembers } = await import("../share-org");
    const result = await shareDocWithOrgMembers("doc-1", "org-1");
    expect(mockPermissionsCreate).toHaveBeenCalledTimes(1);
    expect(result.shared).toEqual(["marcia@example.com"]);
    expect(result.skipped).toContain("OLAVO@example.com");
  });

  it("falha de 1 membro não bloqueia os outros (Promise.allSettled)", async () => {
    mockFindMany.mockResolvedValue([
      { user: { email: "marcia@example.com" } },
      { user: { email: "joao@example.com" } },
      { user: { email: "ana@example.com" } },
    ]);
    mockPermissionsCreate.mockImplementation(
      ({ requestBody }: { requestBody: { emailAddress: string } }) =>
        requestBody.emailAddress === "joao@example.com"
          ? Promise.reject(new Error("Drive 400: invalid email"))
          : Promise.resolve({})
    );
    const { shareDocWithOrgMembers } = await import("../share-org");
    const result = await shareDocWithOrgMembers("doc-1", "org-1");
    expect(result.shared.sort()).toEqual([
      "ana@example.com",
      "marcia@example.com",
    ]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      email: "joao@example.com",
      error: expect.stringContaining("Drive 400"),
    });
  });

  it("filtra users com deletedAt via where do Prisma", async () => {
    mockFindMany.mockResolvedValue([]);
    const { shareDocWithOrgMembers } = await import("../share-org");
    await shareDocWithOrgMembers("doc-1", "org-42");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-42", user: { deletedAt: null } },
      })
    );
  });

  it("não chama Drive se a org está vazia", async () => {
    mockFindMany.mockResolvedValue([]);
    const { shareDocWithOrgMembers } = await import("../share-org");
    const result = await shareDocWithOrgMembers("doc-1", "org-1");
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ shared: [], skipped: [], failed: [] });
  });
});

describe("ensureAnyonePermission", () => {
  it("cria permission anyone quando não existe", async () => {
    mockPermissionsList.mockResolvedValue({ data: { permissions: [] } });
    const { ensureAnyonePermission } = await import("../share-org");
    await ensureAnyonePermission("doc-1", "writer");
    expect(mockPermissionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "doc-1",
        requestBody: {
          type: "anyone",
          role: "writer",
          allowFileDiscovery: false,
        },
        supportsAllDrives: true,
      })
    );
    expect(mockPermissionsUpdate).not.toHaveBeenCalled();
  });

  it("retorna no-op quando anyone já existe com a mesma role", async () => {
    mockPermissionsList.mockResolvedValue({
      data: {
        permissions: [{ id: "anyoneWithLink", type: "anyone", role: "writer" }],
      },
    });
    const { ensureAnyonePermission } = await import("../share-org");
    await ensureAnyonePermission("doc-1", "writer");
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
    expect(mockPermissionsUpdate).not.toHaveBeenCalled();
  });

  it("atualiza role da permission anyone existente em vez de criar nova", async () => {
    mockPermissionsList.mockResolvedValue({
      data: {
        permissions: [{ id: "anyoneWithLink", type: "anyone", role: "writer" }],
      },
    });
    const { ensureAnyonePermission } = await import("../share-org");
    await ensureAnyonePermission("doc-1", "reader");
    expect(mockPermissionsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "doc-1",
        permissionId: "anyoneWithLink",
        requestBody: { role: "reader" },
        supportsAllDrives: true,
      })
    );
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
  });

  it("skip quando owner OAuth não configurado", async () => {
    mockIsOwnerOAuthConfigured.mockReturnValue(false);
    const { ensureAnyonePermission } = await import("../share-org");
    await ensureAnyonePermission("doc-1", "writer");
    expect(mockPermissionsList).not.toHaveBeenCalled();
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
  });

  it("nunca lança — falha do Drive vai pro console", async () => {
    mockPermissionsList.mockRejectedValue(new Error("Drive 500: boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ensureAnyonePermission } = await import("../share-org");
    await expect(
      ensureAnyonePermission("doc-1", "writer")
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
