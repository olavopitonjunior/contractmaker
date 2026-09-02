/**
 * `{{imobiliaria_qualificacao}}` / `{{imobiliaria_dados_pagamento}}` — a
 * própria imobiliária como intermediadora da locação.
 *
 * Nasceu da reingestão da RE/MAX Trio (02/09/2026): 12 dos 16 modelos ficaram
 * barrados pelo gate de PII só pela conta da imobiliária, literal no item a)
 * da cláusula 4.2. O par de chaves do corretor não cobria a imobiliária.
 */
import { describe, it, expect } from "vitest";
import {
  imobiliariaQualificacao,
  imobiliariaDadosPagamento,
} from "../imobiliaria";
import { buildLocacaoPlaceholderMap } from "../placeholder-map";
import { enrichLocacaoData } from "@/lib/locacao/enrich";
import { auditTemplateText } from "../pii-gate";
import { isKnownToken, requiredTokens, catalogForModalidade } from "../placeholder-catalog";

const ORG = {
  nome: "Atrio Negócios Imobiliários Ltda",
  cnpj: "64524938000193",
  creci: "52275-J",
  endereco: "Rua Ribeiro do Vale, nº 514, Brooklin, CEP 04568-001, São Paulo/SP",
};

const base = () =>
  JSON.parse(
    JSON.stringify({
      locadores: [],
      locatarios: [],
      imovel: {},
      aluguel: { valor: 3569.71, dia_vencimento: 10 },
      garantia: { tipo: "caucao" },
      config: {},
    })
  ) as Record<string, unknown>;

describe("imobiliaria — qualificação", () => {
  it("razão social, CNPJ mascarado, CRECI e sede, nessa ordem", () => {
    const enriched = enrichLocacaoData(base(), { administradora: ORG });
    expect(imobiliariaQualificacao(enriched)).toBe(
      "Atrio Negócios Imobiliários Ltda, inscrita no CNPJ sob nº 64.524.938/0001-93, " +
        "CRECI nº 52275-J, com sede na Rua Ribeiro do Vale, nº 514, Brooklin, CEP 04568-001, São Paulo/SP"
    );
  });

  it("cada pedaço só entra se existir; sem razão social a chave é vazia", () => {
    expect(
      imobiliariaQualificacao(enrichLocacaoData(base(), { administradora: { nome: "Só Nome Ltda" } }))
    ).toBe("Só Nome Ltda");
    expect(
      imobiliariaQualificacao(enrichLocacaoData(base(), { administradora: { cnpj: ORG.cnpj } }))
    ).toBe("");
    expect(imobiliariaQualificacao(enrichLocacaoData(base()))).toBe("");
  });

  it("NÃO depende de aluguel.adm_imobiliaria — a intermediação existe sem administração", () => {
    const data = base();
    (data.aluguel as Record<string, unknown>).adm_imobiliaria = false;
    const enriched = enrichLocacaoData(data, { administradora: ORG });
    const config = enriched.config as Record<string, unknown>;
    // Controle: a administradora continua respeitando a decisão do form.
    expect(config.administradora_nome).toBeUndefined();
    expect(config.imobiliaria_nome).toBe(ORG.nome);
    expect(imobiliariaQualificacao(enriched)).toContain("CRECI nº 52275-J");
  });

  it("dataJson já preenchido vence o perfil da org (idempotente)", () => {
    const data = base();
    (data.config as Record<string, unknown>).imobiliaria_nome = "Outra Imobiliária";
    const enriched = enrichLocacaoData(data, { administradora: ORG });
    expect((enriched.config as Record<string, unknown>).imobiliaria_nome).toBe("Outra Imobiliária");
  });
});

describe("imobiliaria — dados de pagamento", () => {
  it("PIX vence a conta e sai na mesma prosa do corretor", () => {
    expect(
      imobiliariaDadosPagamento({
        pix_chave: "64.524.938/0001-93",
        pix_tipo_chave: "CNPJ",
        banco: "Itaú",
        agencia: "7307",
        conta: "96637",
        tipo_conta: "corrente",
        titular_nome: ORG.nome,
        titular_doc: ORG.cnpj,
      })
    ).toBe(
      "na chave PIX (CNPJ): 64.524.938/0001-93, de titularidade de Atrio Negócios Imobiliários Ltda (64.524.938/0001-93)"
    );
  });

  it("sem PIX, conta só entra completa", () => {
    expect(
      imobiliariaDadosPagamento({
        banco: "Itaú BBA",
        agencia: "7307",
        conta: "96637",
        tipo_conta: "corrente",
      })
    ).toBe("no Banco Itaú BBA, Agência 7307, Conta corrente nº 96637");
    expect(imobiliariaDadosPagamento({ banco: "Itaú", agencia: "7307", conta: "96637" })).toBe("");
    expect(imobiliariaDadosPagamento(null)).toBe("");
    expect(
      imobiliariaDadosPagamento({
        pix_chave: "",
        pix_tipo_chave: "",
        banco: "",
        agencia: "",
        conta: "",
        tipo_conta: "",
        titular_nome: "",
        titular_doc: "",
      })
    ).toBe("");
  });
});

describe("imobiliaria — mapa de placeholders", () => {
  it("emite as duas chaves; a via de recebimento NUNCA sai do mapa puro", () => {
    const map = buildLocacaoPlaceholderMap(enrichLocacaoData(base(), { administradora: ORG }));
    expect(map.imobiliaria_qualificacao).toContain("Atrio Negócios Imobiliários Ltda");
    // O call site da geração sobrescreve com o padrão da org — a conta vai
    // para o Doc, nunca para o dataJson.
    expect(map).toHaveProperty("imobiliaria_dados_pagamento", "");
  });

  it("emite as duas chaves vazias quando a org não tem perfil", () => {
    const map = buildLocacaoPlaceholderMap(enrichLocacaoData(base()));
    expect(map).toHaveProperty("imobiliaria_qualificacao", "");
    expect(map).toHaveProperty("imobiliaria_dados_pagamento", "");
  });
});

describe("imobiliaria — é a saída do gate de PII para a cláusula 4.2 a) da Trio", () => {
  const LITERAL =
    "a) R$ 3.569,71 (três mil, quinhentos e sessenta e nove reais e setenta e um centavos), a ser pago " +
    "diretamente à imobiliária intermediadora Atrio Negócios Imobiliários Ltda, inscrita no CRECI/SP sob nº 52275-J, " +
    "CNPJ sob nº 64.524.938/0001-93, com sede na Rua Ribeiro do Vale, nº 514, Brooklin, CEP 04568-001, como honorários " +
    "pela intermediação imobiliária na presente locação, por meio na conta corrente nº96637 mantida na agência 7307, " +
    "do banco ITAÚ BBA S.A. (PIX 64.524.938/0001-93);";
  const COM_CHAVES =
    "a) R$ 3.569,71 (três mil, quinhentos e sessenta e nove reais e setenta e um centavos), a ser pago " +
    "diretamente à imobiliária intermediadora {{imobiliaria_qualificacao}}, como honorários pela intermediação " +
    "imobiliária na presente locação, {{imobiliaria_dados_pagamento}};";

  it("o texto literal É bloqueado — foi o que barrou 12 dos 16 modelos reingeridos", () => {
    const pii = auditTemplateText(LITERAL);
    expect(pii.blocked).toBe(true);
    expect(pii.kinds).toEqual(expect.arrayContaining(["bank_agency", "bank_account"]));
  });

  it("o mesmo item com as chaves NÃO é bloqueado", () => {
    expect(auditTemplateText(COM_CHAVES).blocked).toBe(false);
  });
});

describe("imobiliaria — catálogo", () => {
  it("as duas chaves existem em toda locação, compostas e opcionais", () => {
    for (const m of ["locacao", "locacao_comercial", "temporada"]) {
      expect(isKnownToken("imobiliaria_qualificacao", m)).toBe(true);
      expect(isKnownToken("imobiliaria_dados_pagamento", m)).toBe(true);
      expect(requiredTokens(m)).not.toContain("imobiliaria_qualificacao");
      expect(requiredTokens(m)).not.toContain("imobiliaria_dados_pagamento");
      for (const token of ["imobiliaria_qualificacao", "imobiliaria_dados_pagamento"]) {
        expect(catalogForModalidade(m).find((d) => d.token === token)?.kind).toBe("composed");
      }
    }
  });

  it("não existem na venda", () => {
    expect(isKnownToken("imobiliaria_qualificacao", "a_vista")).toBe(false);
    expect(isKnownToken("imobiliaria_dados_pagamento", "financiamento")).toBe(false);
  });

  it("a descrição diz à IA que é a PRÓPRIA imobiliária e que a conta literal bloqueia", () => {
    const d = catalogForModalidade("locacao").find((x) => x.token === "imobiliaria_dados_pagamento")!;
    expect(d.description).toMatch(/PRÓPRIA imobiliária/);
    expect(d.description).toMatch(/bloqueia a ativação/);
  });
});
