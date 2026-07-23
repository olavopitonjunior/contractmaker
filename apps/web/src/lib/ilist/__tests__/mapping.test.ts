import { describe, expect, it } from "vitest";
import type { IListListing } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  buildSearchText,
  formatEndereco,
  kindForPropertyType,
  toComissaoSeed,
  toLocacaoPropertyFields,
  toProposalSnapshot,
  toVendasImovel,
} from "../mapping";
import { ufForProvince, normalizeProvinceName } from "../geodata";

// Fixture baseada no listing real 710031002-2 da região 71 (QA), pós-sync.
function fixture(overrides: Partial<IListListing> = {}): IListListing {
  return {
    id: "row1",
    orgId: "org1",
    connectionId: "conn1",
    ilistId: "710031002-2",
    externalId: "710031002-2",
    listingCode: "2",
    officeId: 71003,
    associateId: 710031002,
    transactionType: 261, // Sale
    listingStatus: 160,
    propertyTypeUid: 202,
    price: new Prisma.Decimal(655000),
    currency: "BRL",
    bedrooms: 3,
    bathrooms: 4,
    builtArea: 120,
    lotSizeM2: 0,
    parkingSpaces: 5,
    yearBuilt: 2022,
    comTotalPct: 10,
    comBuyAgentPct: null,
    streetName: "Guaxupé",
    streetNumber: "239",
    postalCode: "37136106",
    cityId: 6578921,
    city: "Guaxupé",
    uf: "MG",
    associateName: "Fernanda Vasconcellos",
    associateCreci: "12345-F",
    coverImageUrl: null,
    searchText: "",
    raw: {},
    modifiedAt: null,
    deletedAt: null,
    syncedAt: new Date(),
    ...overrides,
  } as IListListing;
}

describe("mapping → locação (propertyCreateSchema)", () => {
  it("mapeia campos, atributos e origem", () => {
    const f = toLocacaoPropertyFields(fixture(), { fotos: ["https://x/img.jpg"], descricao: "Casa boa" });
    expect(f).toMatchObject({
      kind: "casa",
      status: "disponivel",
      source: "ilist",
      crmId: "710031002-2",
      rua: "Guaxupé",
      numero: "239",
      cidade: "Guaxupé",
      uf: "MG",
      cep: "37136106",
      area: 120,
      fotos: ["https://x/img.jpg"],
      descricaoIa: "Casa boa",
    });
    expect(f.atributos).toMatchObject({ quartos: 3, banheiros: 4, vagas: 5, anoConstrucao: 2022 });
  });

  it("omite uf quando null (schema exige length 2 — nunca enviar vazio)", () => {
    const f = toLocacaoPropertyFields(fixture({ uf: null, city: null }));
    expect("uf" in f).toBe(false);
    expect("cidade" in f).toBe(false);
  });

  it("valorAluguelSugerido só em locação (260) e BRL", () => {
    expect(toLocacaoPropertyFields(fixture()).valorAluguelSugerido).toBeUndefined();
    expect(
      toLocacaoPropertyFields(fixture({ transactionType: 260 })).valorAluguelSugerido,
    ).toBe(655000);
    expect(
      toLocacaoPropertyFields(fixture({ transactionType: 260, currency: "USD" }))
        .valorAluguelSugerido,
    ).toBeUndefined();
  });

  it("PropertyType desconhecido cai em 'outro'", () => {
    expect(kindForPropertyType(999999)).toBe("outro");
    expect(kindForPropertyType(null)).toBe("outro");
  });
});

describe("mapping → vendas (imoveis[] snake_case)", () => {
  it("mapeia endereço e usa descrição da API quando existe", () => {
    const imovel = toVendasImovel(fixture(), { descricao: "Casa em excelente localização para venda" });
    expect(imovel).toMatchObject({
      rua: "Guaxupé",
      numero: "239",
      cidade: "Guaxupé",
      uf: "MG",
      cep: "37136106",
      matricula: "",
      inscricao_iptu: "",
      descricao: "Casa em excelente localização para venda",
    });
  });

  it("fallback de descrição ≥ 10 chars quando API não tem (min10 do step3Schema)", () => {
    const imovel = toVendasImovel(fixture(), {});
    expect(imovel.descricao.length).toBeGreaterThanOrEqual(10);
    expect(imovel.descricao).toContain("3 dorm.");
    expect(imovel.descricao).toContain("ref. iList 2");
  });

  it("descrição curta demais da API também cai no fallback", () => {
    const imovel = toVendasImovel(fixture(), { descricao: "Casa" });
    expect(imovel.descricao.length).toBeGreaterThanOrEqual(10);
    expect(imovel.descricao).not.toBe("Casa");
  });
});

describe("mapping → proposta e comissão", () => {
  it("snapshot com endereço formatado, código e preço BRL", () => {
    const snap = toProposalSnapshot(fixture());
    expect(snap).toEqual({
      endereco: "Guaxupé, 239 — Guaxupé/MG",
      listingCode: "2",
      preco: 655000,
      ilistId: "710031002-2",
    });
  });

  it("preço não-BRL não entra no snapshot", () => {
    expect(toProposalSnapshot(fixture({ currency: "USD" })).preco).toBeUndefined();
  });

  it("seed de comissão com ComTotalPct + corretor/CRECI", () => {
    expect(toComissaoSeed(fixture())).toEqual({
      totalPct: 10,
      corretor: { nome: "Fernanda Vasconcellos", creci: "12345-F" },
    });
  });
});

describe("geodata província→UF", () => {
  it("resolve nomes com e sem acento", () => {
    expect(ufForProvince("São Paulo")).toBe("SP");
    expect(ufForProvince("Sao Paulo")).toBe("SP");
    expect(ufForProvince("ESPÍRITO SANTO")).toBe("ES");
    expect(ufForProvince("Minas Gerais")).toBe("MG");
  });

  it("província desconhecida → null (nunca chutar)", () => {
    expect(ufForProvince("Ontario")).toBeNull();
    expect(ufForProvince(undefined)).toBeNull();
  });

  it("normalização remove acentos e caixa", () => {
    expect(normalizeProvinceName("São Paulo")).toBe("sao paulo");
  });
});

describe("helpers", () => {
  it("formatEndereco degrada até a referência iList", () => {
    expect(
      formatEndereco(fixture({ streetName: null, streetNumber: null, city: null, uf: null })),
    ).toBe("Imóvel iList 2");
  });

  it("buildSearchText junta em lowercase e pula vazios", () => {
    expect(buildSearchText(["ABC", null, undefined, "", "Guaxupé", 239])).toBe("abc guaxupé 239");
  });
});
