import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "../route";
import { prisma } from "@/lib/db/prisma";
import { resolveFormScope } from "@/lib/forms/resolve-form-scope";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn() }));

vi.mock("@/lib/forms/resolve-form-scope", () => ({
  resolveFormScope: vi.fn(),
  formLockedResponse: vi.fn(() => null),
}));

vi.mock("@/lib/forms/form-gate", () => ({
  formClosedResponse: vi.fn(async () => null),
  viewerIsOrgMember: vi.fn(async () => true),
}));

const mockPrisma = vi.mocked(prisma);
const mockResolveFormScope = vi.mocked(resolveFormScope);

const CAMPOS_GRAVADOS = {
  nome_completo: "Felipe Lima",
  cpf_numero: "87515740006",
  cep: "13400000",
};

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/forms/tok/attachments?id=att1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: { token: "tok" } } as never;
}

/** O `extractedData` gravado pela última chamada de update. */
function ultimoExtractedData(): Record<string, unknown> {
  const call = mockPrisma.formAttachment.update.mock.calls.at(-1)?.[0] as {
    data: { extractedData: Record<string, unknown> };
  };
  return call.data.extractedData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveFormScope.mockResolvedValue({
    formId: "form1",
    orgId: "org1",
    participantId: null,
    role: null,
    schemaType: "locacao_residencial_v1",
  } as never);
  mockPrisma.formAttachment.findUnique.mockResolvedValue({
    id: "att1",
    formId: "form1",
    participantId: null,
    extractedData: {
      fields: { ...CAMPOS_GRAVADOS },
      category: "rg",
      confidence: 0.9,
      assignment: { kind: "locatario", index: 0 },
    },
  } as never);
  mockPrisma.formAttachment.update.mockImplementation(
    async ({ data }: never) => ({ id: "att1", ...(data as object) }) as never
  );
});

/**
 * A correção manual dos campos extraídos entra por uma rota ANÔNIMA (token do
 * formulário) e o resultado alimenta o autofill. Estes testes travam o que a
 * sanitização precisa recusar — não é validação cosmética.
 */
describe("PATCH /api/forms/[token]/attachments — correção de campos", () => {
  it("grava a correção de um campo existente", async () => {
    const res = await PATCH(makeReq({ fields: { cpf_numero: "39028174005" } }), params());
    expect(res.status).toBe(200);
    expect(ultimoExtractedData().fields).toEqual({
      ...CAMPOS_GRAVADOS,
      cpf_numero: "39028174005",
    });
  });

  it("string vazia REMOVE o campo (é como se descarta uma leitura errada)", async () => {
    await PATCH(makeReq({ fields: { cep: "" } }), params());
    const fields = ultimoExtractedData().fields as Record<string, unknown>;
    expect(fields).not.toHaveProperty("cep");
    expect(fields.nome_completo).toBe("Felipe Lima");
  });

  it("ignora chave que o OCR não produziu — nada de campo inventado", async () => {
    await PATCH(makeReq({ fields: { renda_mensal: "999999" } }), params());
    expect(ultimoExtractedData().fields).toEqual(CAMPOS_GRAVADOS);
  });

  it("não deixa a edição sobrescrever assignment/category/confidence", async () => {
    await PATCH(
      makeReq({
        fields: {
          assignment: "x",
          category: "matricula",
          confidence: "1",
          nome_completo: "Nome Corrigido",
        },
      }),
      params()
    );
    const ed = ultimoExtractedData();
    expect(ed.category).toBe("rg");
    expect(ed.confidence).toBe(0.9);
    expect(ed.assignment).toEqual({ kind: "locatario", index: 0 });
    expect((ed.fields as Record<string, unknown>).nome_completo).toBe("Nome Corrigido");
  });

  it("recusa valor que não é string", async () => {
    const res = await PATCH(makeReq({ fields: { cpf_numero: 123 } }), params());
    expect(res.status).toBe(400);
    expect(mockPrisma.formAttachment.update).not.toHaveBeenCalled();
  });

  it("recusa valor acima do teto de comprimento", async () => {
    const res = await PATCH(
      makeReq({ fields: { nome_completo: "x".repeat(501) } }),
      params()
    );
    expect(res.status).toBe(400);
    expect(mockPrisma.formAttachment.update).not.toHaveBeenCalled();
  });

  it("recusa corpo sem assignment nem fields", async () => {
    const res = await PATCH(makeReq({}), params());
    expect(res.status).toBe(400);
  });

  it("assignment sozinho continua funcionando (contrato anterior)", async () => {
    const res = await PATCH(
      makeReq({ assignment: { kind: "locador", index: 1 } }),
      params()
    );
    expect(res.status).toBe(200);
    const ed = ultimoExtractedData();
    expect(ed.assignment).toEqual({ kind: "locador", index: 1 });
    expect(ed.fields).toEqual(CAMPOS_GRAVADOS);
  });

  it("assignment inválido segue sendo 400", async () => {
    const res = await PATCH(makeReq({ assignment: { kind: "hacker" } }), params());
    expect(res.status).toBe(400);
  });
});
