import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFilesCreate = vi.fn();
const mockPermissionsCreate = vi.fn();
const mockGetOwnerDriveClient = vi.fn(() => ({
  files: { create: mockFilesCreate },
  permissions: { create: mockPermissionsCreate },
}));
const mockGetServiceAccountEmail = vi.fn();
const mockGetDriveFolderId = vi.fn();
const mockIsOwnerOAuthConfigured = vi.fn();

vi.mock("../client", () => ({
  getOwnerDriveClient: mockGetOwnerDriveClient,
  getServiceAccountEmail: mockGetServiceAccountEmail,
  getDriveFolderId: mockGetDriveFolderId,
  isOwnerOAuthConfigured: mockIsOwnerOAuthConfigured,
}));

// Seam multitenant: sem orgId os módulos resolvem a credencial global; aqui
// devolvemos o mesmo drive mockado e o folder do env, preservando os asserts.
vi.mock("../org-oauth", () => ({
  withOwnerAuth: (_orgId: string | undefined, fn: (r: unknown) => Promise<unknown>) =>
    fn({ auth: {}, source: "global" }),
  resolveOwnerAuth: vi.fn(async () => ({ auth: {}, source: "global" })),
  getOwnerDriveForAuth: () => mockGetOwnerDriveClient(),
  resolveDriveParent: vi.fn(async () => mockGetDriveFolderId()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsOwnerOAuthConfigured.mockReturnValue(true);
  mockGetServiceAccountEmail.mockReturnValue("sa@example.iam.gserviceaccount.com");
  mockGetDriveFolderId.mockReturnValue("folder-1");
  mockFilesCreate.mockResolvedValue({
    data: {
      id: "doc-abc",
      webViewLink: "https://docs.google.com/document/d/doc-abc/edit",
    },
  });
  mockPermissionsCreate.mockResolvedValue({});
});

describe("uploadFileAsGoogleDoc", () => {
  it("erro quando OAuth do owner não está configurado", async () => {
    mockIsOwnerOAuthConfigured.mockReturnValue(false);
    const { uploadFileAsGoogleDoc } = await import("../upload-file-as-gdoc");
    await expect(
      uploadFileAsGoogleDoc({
        buffer: Buffer.from("%PDF-1.4 a"),
        sourceMime: "application/pdf",
        name: "test",
      })
    ).rejects.toThrow(/GOOGLE_OWNER_REFRESH_TOKEN/);
  });

  it("erro quando buffer está vazio", async () => {
    const { uploadFileAsGoogleDoc } = await import("../upload-file-as-gdoc");
    await expect(
      uploadFileAsGoogleDoc({
        buffer: Buffer.alloc(0),
        sourceMime: "application/pdf",
        name: "test",
      })
    ).rejects.toThrow(/vazio/i);
  });

  it("cria GDoc com mimeType de conversão correto e media com mime original", async () => {
    const { uploadFileAsGoogleDoc } = await import("../upload-file-as-gdoc");
    const result = await uploadFileAsGoogleDoc({
      buffer: Buffer.from("%PDF-1.4 conteudo"),
      sourceMime: "application/pdf",
      name: "Contrato XYZ",
    });

    expect(mockFilesCreate).toHaveBeenCalledOnce();
    const call = mockFilesCreate.mock.calls[0][0];
    expect(call.requestBody.mimeType).toBe("application/vnd.google-apps.document");
    expect(call.requestBody.name).toBe("Contrato XYZ");
    expect(call.requestBody.parents).toEqual(["folder-1"]);
    expect(call.media.mimeType).toBe("application/pdf");
    expect(call.fields).toContain("id");

    expect(result).toEqual({
      docId: "doc-abc",
      webViewLink: "https://docs.google.com/document/d/doc-abc/edit",
      embedLink:
        "https://docs.google.com/document/d/doc-abc/edit?embedded=true&rm=embedded",
    });
  });

  it("compartilha com SA como writer", async () => {
    const { uploadFileAsGoogleDoc } = await import("../upload-file-as-gdoc");
    await uploadFileAsGoogleDoc({
      buffer: Buffer.from("%PDF-1.4 x"),
      sourceMime: "application/pdf",
      name: "x",
    });
    expect(mockPermissionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "doc-abc",
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress: "sa@example.iam.gserviceaccount.com",
        },
      })
    );
  });

  it("aceita DOCX como sourceMime", async () => {
    const { uploadFileAsGoogleDoc } = await import("../upload-file-as-gdoc");
    await uploadFileAsGoogleDoc({
      buffer: Buffer.from("PK docx-content"),
      sourceMime:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      name: "x",
    });
    expect(mockFilesCreate.mock.calls[0][0].media.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("não compartilha com SA quando email não disponível", async () => {
    mockGetServiceAccountEmail.mockReturnValue(null);
    const { uploadFileAsGoogleDoc } = await import("../upload-file-as-gdoc");
    await uploadFileAsGoogleDoc({
      buffer: Buffer.from("%PDF-1.4 a"),
      sourceMime: "application/pdf",
      name: "x",
    });
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
  });
});
