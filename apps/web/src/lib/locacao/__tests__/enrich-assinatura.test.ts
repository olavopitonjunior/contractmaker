import { describe, it, expect } from "vitest";
import { enrichLocacaoData } from "../enrich";
import { DEFAULT_LOCACAO_SETTINGS } from "@/lib/contracts/default-config";

/**
 * Praça de assinatura depois que a etapa "Confirmação e Assinatura" saiu do
 * formulário de locação (2026-07-30).
 *
 * O wizard SEMPRE mandou `assinatura: { cidade: "", uf: "", data: "" }` no
 * dataJson. Com o merge antigo (objeto inteiro, só quando `assinatura == null`)
 * o padrão da org nunca era aplicado — o que era inofensivo enquanto o cliente
 * preenchia a etapa, e vira dado faltando agora que a única fonte é a
 * configuração da imobiliária. O merge é CAMPO A CAMPO.
 */

type AnyObj = Record<string, unknown>;

const settings = (over: Partial<typeof DEFAULT_LOCACAO_SETTINGS.assinatura>) => ({
  ...DEFAULT_LOCACAO_SETTINGS,
  assinatura: { ...DEFAULT_LOCACAO_SETTINGS.assinatura, ...over },
});

describe("enrichLocacaoData — praça de assinatura", () => {
  it("preenche cidade/UF vazias do form com o padrão da org", () => {
    const out = enrichLocacaoData(
      {
        assinatura: { cidade: "", uf: "", data: "" },
        imovel: { cidade: "Santos", uf: "SP" },
      },
      { contractDefaults: settings({ cidade: "São Paulo", uf: "SP" }) },
    ) as AnyObj;

    expect(out.assinatura).toMatchObject({ cidade: "São Paulo", uf: "SP" });
    expect((out.config as AnyObj).municipio_imovel).toBe("São Paulo/SP");
  });

  it("sem configuração da org, cai na cidade do imóvel (comportamento antigo)", () => {
    const out = enrichLocacaoData({
      assinatura: { cidade: "", uf: "", data: "" },
      imovel: { cidade: "Santos", uf: "SP" },
    }) as AnyObj;

    expect((out.config as AnyObj).municipio_imovel).toBe("Santos/SP");
  });

  it("cidade explícita no negócio vence a configuração da org", () => {
    const out = enrichLocacaoData(
      { assinatura: { cidade: "Campinas", uf: "SP", data: "" } },
      { contractDefaults: settings({ cidade: "São Paulo", uf: "SP" }) },
    ) as AnyObj;

    expect((out.assinatura as AnyObj).cidade).toBe("Campinas");
    expect((out.config as AnyObj).municipio_imovel).toBe("Campinas/SP");
  });

  it("a DATA continua por negócio: sem data no form e sem data na org, nada é inventado", () => {
    const out = enrichLocacaoData(
      { assinatura: { cidade: "", uf: "", data: "" } },
      { contractDefaults: settings({ cidade: "São Paulo", uf: "SP" }) },
    ) as AnyObj;

    expect((out.assinatura as AnyObj).data).toBe("");
    expect((out.config as AnyObj).data_assinatura).toBeUndefined();
  });

  it("dataJson sem bloco `assinatura` e org sem padrão não cria o bloco", () => {
    const out = enrichLocacaoData({ imovel: { cidade: "Santos", uf: "SP" } }) as AnyObj;
    expect(out.assinatura).toBeUndefined();
    expect((out.config as AnyObj).municipio_imovel).toBe("Santos/SP");
  });

  it("foro vazio herda a comarca da org (a etapa que o coletava saiu)", () => {
    const out = enrichLocacaoData(
      { foro: "" },
      { contractDefaults: { ...DEFAULT_LOCACAO_SETTINGS, foro: "São Paulo/SP" } },
    ) as AnyObj;
    expect(out.foro).toBe("São Paulo/SP");
  });
});
