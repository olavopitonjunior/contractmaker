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

/**
 * A revalidação é o ESPELHO do Doc, nos dois sentidos.
 *
 * O mapa de slots do `draftReport` só subia (false→true). Um `applied: true`
 * gravado por engano — a ingestão presumia a troca sem conferir — virava
 * permanente, e a revalidação, o único ponto que relê o Doc, confirmava a
 * mentira. Template declarado com slot ausente gera contrato com a garantia da
 * variante de referência chumbada, seja qual for a escolha do formulário.
 * Achado montando a biblioteca da RE/MAX Trio em produção (19/08/2026).
 */
describe("POST /api/templates/[id]/validate-gdoc — reconciliação de slots", () => {
  const HEADER = "<!-- engine=google_docs: a fonte é o Google Doc -->";

  function withSlotReport(
    slot: Record<string, unknown>,
    handlebarsSource = [HEADER, "<!-- slots: {{slot_garantia}} -->"].join("\n")
  ) {
    p.contractTemplate.findUnique = vi.fn().mockResolvedValue({
      id: "t1",
      orgId: "org-1",
      engine: "google_docs",
      googleTemplateDocId: "doc-123",
      modalidade: "locacao",
      handlebarsSource,
      draftReport: { slots: [slot] },
    });
  }

  const updateArgs = () => p.contractTemplate.update.mock.calls[0]?.[0];

  it("REBAIXA applied true→false quando o token sumiu do Doc", async () => {
    withSlotReport({
      slot: "garantia",
      applied: true,
      token: "{{slot_garantia}}",
      issues: [],
    });
    // Doc sem o token: o modelo foi editado à mão, ou a ingestão nunca aplicou.
    mockDocText.mockResolvedValue(
      "CLÁUSULA OITAVA - DA GARANTIA\nTexto de fiador chumbado no modelo."
    );

    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.slots[0]).toMatchObject({ slot: "garantia", applied: false, token: null });
    // O gate da página de revisão (`failedSlots`) volta a travar a ativação.
    expect(body.slots[0].issues.at(-1)).toMatchObject({ reason: "token-missing" });
    expect(updateArgs().data.draftReport.slots[0].applied).toBe(false);
  });

  it("PROMOVE false→true quando o operador escreve o token à mão", async () => {
    withSlotReport(
      {
        slot: "garantia",
        applied: false,
        token: null,
        issues: [{ paragraph: "…", reason: "not-found" }],
      },
      HEADER
    );
    mockDocText.mockResolvedValue("CLÁUSULA OITAVA - DA GARANTIA\n{{slot_garantia}}");

    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });
    const body = await res.json();

    expect(body.slots[0]).toMatchObject({
      applied: true,
      token: "{{slot_garantia}}",
      issues: [],
    });
    expect(updateArgs().data.handlebarsSource).toContain("slot_garantia");
  });

  it("slot que já estava applied:false não ganha issue duplicada a cada revalidação", async () => {
    withSlotReport(
      {
        slot: "garantia",
        applied: false,
        token: null,
        issues: [{ paragraph: "…", reason: "ambiguous" }],
      },
      HEADER
    );
    mockDocText.mockResolvedValue("Texto sem token nenhum.");

    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });
    const body = await res.json();

    expect(body.slots[0].applied).toBe(false);
    expect(body.slots[0].issues).toHaveLength(1);
    expect(body.slots[0].issues[0].reason).toBe("ambiguous");
  });

  it("Doc inacessível NÃO rebaixa nada — 502 sem tocar no banco", async () => {
    // Trava contra o modo de falha oposto: 403/429 da API do Google não pode
    // ser lido como "o token sumiu" e zerar um `applied` legítimo.
    withSlotReport({
      slot: "garantia",
      applied: true,
      token: "{{slot_garantia}}",
      issues: [],
    });
    mockDocText.mockRejectedValue(new Error("Rate Limit Exceeded"));

    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });

    expect(res.status).toBe(502);
    expect(p.contractTemplate.update).not.toHaveBeenCalled();
  });

  it("o update é escopado por orgId (isolamento de tenant)", async () => {
    withSlotReport({
      slot: "garantia",
      applied: true,
      token: "{{slot_garantia}}",
      issues: [],
    });
    mockDocText.mockResolvedValue("{{slot_garantia}}");

    await POST(new Request("http://localhost"), { params: { id: "t1" } });

    expect(updateArgs().where).toEqual({ id: "t1", orgId: "org-1" });
  });
});

/**
 * A revalidação também espelha o gate de PII (lib/templates/pii-gate.ts): é o
 * único ponto além da ingestão que relê o Doc inteiro, então é aqui que o
 * conserto manual (trocar o trecho por uma chave) passa a valer na trava da
 * ativação — e que o modelo legado, ingerido antes do gate, ganha a medida.
 */
describe("POST /api/templates/[id]/validate-gdoc — espelho do gate de PII", () => {
  const HEADER = "<!-- engine=google_docs: a fonte é o Google Doc -->";
  function withReport(draftReport: Record<string, unknown> | null) {
    p.contractTemplate.findUnique = vi.fn().mockResolvedValue({
      id: "t1",
      orgId: "org-1",
      engine: "google_docs",
      googleTemplateDocId: "doc-123",
      modalidade: "locacao",
      handlebarsSource: HEADER,
      draftReport,
    });
  }
  const updateArgs = () => p.contractTemplate.update.mock.calls[0]?.[0];

  it("Doc com CPF literal → draftReport.pii.blocked = true", async () => {
    withReport({ inserted: [] });
    mockDocText.mockResolvedValue("{{locadores_qualificacao}}\nCPF nº 529.982.247-25");
    const res = await POST(new Request("http://localhost"), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    expect(updateArgs().data.draftReport.pii).toMatchObject({ blocked: true, kinds: ["cpf"] });
  });

  it("operador trocou o trecho pela chave e revalidou → trava some (blocked = false)", async () => {
    withReport({ pii: { blocked: true, kinds: ["cpf"], count: 1, warnings: [], checkedAt: "" } });
    mockDocText.mockResolvedValue("{{locadores_qualificacao}}\n{{locatarios_qualificacao}}");
    await POST(new Request("http://localhost"), { params: { id: "t1" } });
    expect(updateArgs().data.draftReport.pii).toMatchObject({ blocked: false, kinds: [] });
  });

  it("export VAZIO não apaga um blocked:true anterior (não medido ≠ limpo)", async () => {
    withReport({ pii: { blocked: true, kinds: ["cpf"], count: 1, warnings: [], checkedAt: "x" } });
    mockDocText.mockResolvedValue("");
    await POST(new Request("http://localhost"), { params: { id: "t1" } });
    expect(updateArgs().data.draftReport.pii).toMatchObject({ blocked: true, kinds: ["cpf"] });
  });

  it("modelo legado sem relatório ganha a medida na primeira revalidação", async () => {
    withReport(null);
    mockDocText.mockResolvedValue("Agência 0001, Conta Corrente 682331986-6");
    await POST(new Request("http://localhost"), { params: { id: "t1" } });
    expect(updateArgs().data.draftReport.pii.blocked).toBe(true);
  });
});
