/**
 * A page do formulário público entrega o catálogo de garantias SERVER-SIDE.
 *
 * O form é anônimo (nenhuma sessão, nenhuma org no contexto), então ele não
 * pode chamar `/api/org/garantia-options`. O catálogo desce como prop, no mesmo
 * caminho do `requiredFieldsByStep` — se isto quebrar, o GarantiaStep silenciosa
 * mente volta pros defaults e a imobiliária não vê as garantidoras dela.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/forms/form-gate", () => ({
  canAccessForm: vi.fn().mockResolvedValue(true),
  viewerIsOrgMember: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/forms/required-snapshot", () => ({
  resolveFormRequiredFields: vi.fn().mockResolvedValue([[], [], [], [], [], []]),
}));

import PublicFormPage from "../page";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

const form = (schemaType: string) => ({
  id: "f1",
  token: "tok",
  orgId: "org-1",
  schemaType,
  dataJson: {},
  lockedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  p.garantiaOption = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "g1",
        tipo: "seguro_fianca",
        provider: "Pottencial",
        label: null,
        active: true,
        position: 0,
      },
    ]),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const render = async (schemaType: string): Promise<any> => {
  p.salesForm.findUnique = vi.fn().mockResolvedValue(form(schemaType));
  return PublicFormPage({
    params: { token: "tok" },
    searchParams: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
};

describe("page do formulário público — catálogo de garantias", () => {
  it("locação recebe as opções ATIVAS da org", async () => {
    const el = await render("locacao_residencial_v1");
    expect(el.props.garantiaOptions).toEqual([
      expect.objectContaining({ tipo: "seguro_fianca", provider: "Pottencial" }),
    ]);
    expect(p.garantiaOption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org-1" } }),
    );
  });

  it("locação comercial também", async () => {
    const el = await render("locacao_comercial_v1");
    expect(el.props.garantiaOptions).toHaveLength(1);
  });

  it("venda não consulta o catálogo (não tem etapa de garantia)", async () => {
    const el = await render("venda_v1");
    expect(el.props.garantiaOptions).toBeUndefined();
    expect(p.garantiaOption.findMany).not.toHaveBeenCalled();
  });
});
