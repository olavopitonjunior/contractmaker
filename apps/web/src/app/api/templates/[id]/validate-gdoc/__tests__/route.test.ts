import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getDocPlainText } from "@/lib/google/docs";
import { GOOGLE_REAUTH_MESSAGE } from "@/lib/google/auth-error";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

vi.mock("@/lib/google/docs", () => ({ getDocPlainText: vi.fn() }));
vi.mock("@/lib/google/client", () => ({ isGoogleDocsConfigured: vi.fn(() => true) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockDocText = vi.mocked(getDocPlainText);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(createMockSession() as never);
  mockGetUserOrg.mockResolvedValue(createMockOrg({ id: "org-1" }) as never);
  p.contractTemplate.findUnique = vi.fn().mockResolvedValue({
    id: "t1",
    orgId: "org-1",
    engine: "google_docs",
    googleTemplateDocId: "doc-123",
    modalidade: "a_vista",
    draftReport: null,
  });
  p.contractTemplate.update = vi.fn().mockResolvedValue({});
});

describe("POST /api/templates/[id]/validate-gdoc — erro de credencial Google", () => {
  it("traduz invalid_grant em instrução acionável", async () => {
    // O erro cru ("invalid_grant") não diz o que fazer — e é o mais comum aqui:
    // em projeto OAuth "Testing" o refresh token expira a cada 7 dias.
    mockDocText.mockRejectedValue(
      new Error("invalid_grant: Token has been expired or revoked.")
    );
    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe(GOOGLE_REAUTH_MESSAGE);
    expect(json.error).not.toContain("invalid_grant");
  });

  it("erro que NÃO é de credencial mantém a mensagem original", async () => {
    mockDocText.mockRejectedValue(new Error("Requested entity was not found."));
    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Requested entity was not found");
  });

  it("sucesso segue devolvendo o relatório de placeholders", async () => {
    mockDocText.mockResolvedValue("Contrato de {{vendedor_nome}}");
    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
