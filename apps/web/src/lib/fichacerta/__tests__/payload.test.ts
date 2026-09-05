import { describe, it, expect } from "vitest";
import { buildApplicantPayload, buildSolicitationPayload, fmtDate } from "../payload";
import { derivePretendentes } from "@/lib/credit/pretendentes";

const CPF_OK = "52998224725";

const DATA = {
  locatarios: [
    {
      nome: "Maria Souza",
      cpf: CPF_OK,
      data_nascimento: "10/05/1990",
      nome_mae: "Ana Souza",
      renda_mensal: 3500,
      renda_origem: 11,
      cep: "80000000",
      endereco: "Rua A",
      numero: "10",
      cidade: "Curitiba",
      uf: "PR",
      conjuge: { nome: "João", cpf: "11144477735" },
    },
  ],
  locacao: { valor_aluguel: 3200, condominio: "350,00" },
  imovel: { rua: "Av. Beira-Mar, 12", cidade: "Florianópolis", uf: "SC" },
  garantia: { tipo: "fiador", fiador: { tipo_pessoa: "juridica", razao_social: "Fiança S.A.", cnpj: "11222333000181" } },
};

describe("payload da Ficha Certa", () => {
  it("fmtDate aceita dd/mm/aaaa e ISO; rejeita o resto", () => {
    expect(fmtDate("10/05/1990")).toBe("1990-05-10");
    expect(fmtDate("1990-05-10")).toBe("1990-05-10");
    expect(fmtDate("1990-05-10T00:00:00.000Z")).toBe("1990-05-10");
    expect(fmtDate("maio de 1990")).toBeUndefined();
  });

  it("PF residencial: tipo, nome, cpf só dígitos, data ISO, nome da mãe, residir, endereço e renda com origem", () => {
    const [loc] = derivePretendentes(DATA);
    const body = buildApplicantPayload(loc, "RESIDENCIAL");
    expect(body).toEqual({
      tipo_pretendente: "INQUILINO",
      nome: "Maria Souza",
      cpf: CPF_OK,
      data_nascimento: "1990-05-10",
      nome_mae: "Ana Souza",
      residir: true,
      endereco: { cep: "80000000", logradouro: "Rua A", cidade: "Curitiba", uf: "PR", numero: "10" },
      renda: { principal: { origem: 11, valor: "3500.00" }, outra: { origem: "" } },
    });
  });

  it("PF comercial: participante em vez de residir; cônjuge sem renda → origem vazia, sem valor", () => {
    const list = derivePretendentes(DATA);
    const conj = list.find((p) => p.kind === "conjuge_locatario")!;
    const body = buildApplicantPayload(conj, "NAO_RESIDENCIAL");
    expect(body).toMatchObject({ tipo_pretendente: "CONJUGE_INQUILINO", participante: true });
    expect(body).not.toHaveProperty("residir");
    expect((body as { renda: unknown }).renda).toEqual({ principal: { origem: "" }, outra: { origem: "" } });
  });

  it("PJ → OUTROS com razão social e CNPJ, sem renda", () => {
    const list = derivePretendentes(DATA);
    const fiador = list.find((p) => p.kind === "fiador")!;
    expect(buildApplicantPayload(fiador, "RESIDENCIAL")).toEqual({
      tipo_pretendente: "OUTROS",
      razao_social: "Fiança S.A.",
      cnpj: "11222333000181",
    });
  });

  it("solicitação: produtos, locação com aluguel/condomínio como string decimal, código = proposta, endereço do imóvel, 1º pretendente", () => {
    const [loc] = derivePretendentes(DATA);
    const body = buildSolicitationPayload(
      { dataJson: DATA, schemaType: "locacao_residencial_v1", code: "PROP-2026-0013", produtos: [1, 9] },
      loc
    );
    expect(body.produtos).toEqual([1, 9]);
    expect(body.locacao).toEqual({
      tipo_imovel: "RESIDENCIAL",
      codigo_imovel: "PROP-2026-0013",
      aluguel: "3200.00",
      condominio: "350.00",
      endereco: { logradouro: "Av. Beira-Mar, 12", cidade: "Florianópolis", uf: "SC" },
    });
    expect(body.pretendente).toMatchObject({ tipo_pretendente: "INQUILINO", cpf: CPF_OK });
  });

  it("solicitação comercial usa listingCode do anúncio quando existe e o aluguel de `aluguel.valor` como fallback", () => {
    const data = {
      locatarios: [{ nome: "ACME", tipo_pessoa: "juridica", cnpj: "11222333000181" }],
      aluguel: { valor: "4.000,00" },
      imoveis: [{ endereco: "Rua B, 1", listingCode: "IL-77" }],
    };
    const [pj] = derivePretendentes(data);
    const body = buildSolicitationPayload({ dataJson: data, schemaType: "locacao_comercial_v1", code: "PROP-1", produtos: [4] }, pj);
    expect(body.locacao).toMatchObject({ tipo_imovel: "NAO_RESIDENCIAL", codigo_imovel: "IL-77", aluguel: "4000.00", endereco: { logradouro: "Rua B, 1" } });
  });
});
