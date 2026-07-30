import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { salesForm: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/forms/atomic-merge", () => ({
  mergeSalesFormDataJson: vi.fn(async () => ({})),
}));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/asaas/commissioner-registry", () => ({
  upsertCommissionerFromFormData: vi.fn(),
}));

import { autoRegisterFormCommissioners } from "../auto-register-commissioners";
import { prisma } from "@/lib/db/prisma";
import { mergeSalesFormDataJson } from "@/lib/forms/atomic-merge";
import { upsertCommissionerFromFormData } from "@/lib/asaas/commissioner-registry";

const findUnique = vi.mocked(prisma.salesForm.findUnique);
const mergeMock = vi.mocked(mergeSalesFormDataJson);
const upsertMock = vi.mocked(upsertCommissionerFromFormData);

function mockForm(dataJson: Record<string, unknown>) {
  findUnique.mockResolvedValue({
    id: "form-1",
    orgId: "org-1",
    dataJson,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

/** `comissao` gravada pelo merge atômico no fim do helper. */
function writtenComissao(): Record<string, unknown> {
  const call = mergeMock.mock.calls.at(-1)?.[0];
  return (call?.incoming as Record<string, unknown>)
    ?.comissao as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  upsertMock.mockImplementation(async () => ({ id: `sr-${++n}`, existed: false }));
});

describe("autoRegisterFormCommissioners — locação (angariadores)", () => {
  it("cadastra angariadores e backfilla splitRecipientId", async () => {
    mockForm({
      comissao: {
        taxa_locacao_percent: 100,
        angariadores: [
          {
            nome: "Carla Angariadora",
            tipo_pessoa: "fisica",
            cpf: "111.444.777-35",
            creci: "199.905",
            email: "carla@imob.com",
            mobile_phone: "(11) 99999-0000",
            forma_comissao: "percentual",
            percentual: 10,
          },
        ],
      },
    });

    await autoRegisterFormCommissioners({ formId: "form-1", orgId: "org-1" });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith("org-1", {
      nome: "Carla Angariadora",
      cpf: "111.444.777-35",
      cnpj: null,
      tipo_pessoa: "fisica",
      email: "carla@imob.com",
      mobile_phone: "(11) 99999-0000",
      creci: "199.905",
      // Angariador não tem `papel` no form — entra como captador.
      papel: "captador",
    });

    const angariadores = writtenComissao().angariadores as Array<
      Record<string, unknown>
    >;
    expect(angariadores[0].splitRecipientId).toBe("sr-1");
  });

  it("grava escopado em `comissao` (allowlist) — não regrava o blob inteiro", async () => {
    mockForm({
      locadores: [{ nome: "João" }],
      comissao: { angariadores: [{ nome: "Carla", cpf: "111.444.777-35" }] },
    });

    await autoRegisterFormCommissioners({ formId: "form-1", orgId: "org-1" });

    const call = mergeMock.mock.calls.at(-1)?.[0];
    expect(call?.allowedTopKeys).toEqual(["comissao"]);
    expect(Object.keys(call?.incoming ?? {})).toEqual(["comissao"]);
  });

  it("pula angariador que já tem splitRecipientId", async () => {
    mockForm({
      comissao: {
        angariadores: [{ nome: "Carla", splitRecipientId: "sr-existente" }],
      },
    });

    await autoRegisterFormCommissioners({ formId: "form-1", orgId: "org-1" });

    expect(upsertMock).not.toHaveBeenCalled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("no-op quando não há comissionados nem angariadores", async () => {
    mockForm({ comissao: { taxa_locacao_percent: 100 } });

    await autoRegisterFormCommissioners({ formId: "form-1", orgId: "org-1" });

    expect(upsertMock).not.toHaveBeenCalled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("nunca lança quando o upsert falha — só não backfilla", async () => {
    mockForm({
      comissao: { angariadores: [{ nome: "Carla", cpf: "111.444.777-35" }] },
    });
    upsertMock.mockRejectedValue(new Error("boom"));

    await expect(
      autoRegisterFormCommissioners({ formId: "form-1", orgId: "org-1" })
    ).resolves.toBeUndefined();
    expect(mergeMock).not.toHaveBeenCalled();
  });
});

describe("autoRegisterFormCommissioners — vendas (comissionados) segue igual", () => {
  it("preserva o `papel` informado e não injeta captador", async () => {
    mockForm({
      comissao: {
        comissionados: [
          {
            nome: "Imob X",
            tipo_pessoa: "juridica",
            cnpj: "11.222.333/0001-81",
            papel: "imobiliaria_principal",
          },
        ],
      },
    });

    await autoRegisterFormCommissioners({ formId: "form-1", orgId: "org-1" });

    expect(upsertMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ papel: "imobiliaria_principal" })
    );
  });

  it("comissionado sem papel continua sem papel (null)", async () => {
    mockForm({ comissao: { comissionados: [{ nome: "Imob X" }] } });

    await autoRegisterFormCommissioners({ formId: "form-1", orgId: "org-1" });

    expect(upsertMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ papel: null })
    );
  });
});
