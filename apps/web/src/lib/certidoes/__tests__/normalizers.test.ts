import { describe, it, expect } from "vitest";
import { normalize } from "../normalizers";
import { mapInfosimplesCodeToCategory } from "../error-codes";
import type { InfosimplesResponse } from "../types";

import pgfnNegativa from "../__fixtures__/pgfn-negativa.json";
import pgfnPositivaEfeitos from "../__fixtures__/pgfn-positiva-efeitos.json";
import cndtNegativa from "../__fixtures__/cndt-negativa.json";
import trfOk from "../__fixtures__/trf-unificada-negativa.json";
import trfFail from "../__fixtures__/trf-unificada-falha.json";
import ceatNeg from "../__fixtures__/ceat-trt2-negativa.json";
import cenprotLimpo from "../__fixtures__/cenprot-sp-limpo.json";
import cenprotComProtesto from "../__fixtures__/cenprot-sp-com-protesto.json";
import ieptbLimpo from "../__fixtures__/ieptb-nacional-limpo.json";
import ieptbComProtesto from "../__fixtures__/ieptb-nacional-com-protesto.json";
import ieptbDetalhesSp from "../__fixtures__/ieptb-detalhes-sp.json";
import iptuSp from "../__fixtures__/iptu-sp-negativa.json";
import businessError from "../__fixtures__/business-error-606.json";
import pgfnMissing612 from "../__fixtures__/pgfn-missing-birthdate-612.json";
import pgfnMismatch614 from "../__fixtures__/pgfn-birthdate-mismatch-614.json";
import portal666 from "../__fixtures__/portal-unavailable-666.json";
import rate668 from "../__fixtures__/rate-limited-668.json";
import noBalance603 from "../__fixtures__/account-no-balance-603.json";
import noData600 from "../__fixtures__/genuine-no-data-600.json";
import receitaCnpj from "../__fixtures__/receita-cnpj-ativo.json";
import caixaCrf from "../__fixtures__/caixa-crf-regular.json";
import sefazUnif from "../__fixtures__/sefaz-unificada-negativa.json";
import trf3Code602 from "../__fixtures__/trf3-code602.json";
import pgeSpCode602 from "../__fixtures__/pge-sp-code602.json";
import pgfnDebitosFlags from "../__fixtures__/pgfn-debitos-flags.json";

describe("normalize — PGFN", () => {
  it("marca Negativa", () => {
    const r = normalize("receita-federal/pgfn", pgfnNegativa as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("14/10/2026");
    expect(r.consta_debito).toBe(false);
  });

  it("marca Positiva com Efeitos", () => {
    const r = normalize(
      "receita-federal/pgfn",
      pgfnPositivaEfeitos as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva_com_efeitos");
    expect(r.consta_debito).toBe(true);
  });

  // H.2 — Phase H: cascade resolution
  it("cascade: debitos_rfb=false + debitos_pgfn=false → negativa (mesmo com situacao=null)", () => {
    const r = normalize(
      "receita-federal/pgfn",
      pgfnDebitosFlags as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
    expect(r.validade).toBe("14/10/2026");
  });

  it("cascade: debitos_rfb=true → positiva", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [
        {
          cpf: "12345678900",
          certidao: "CERTIDÃO POSITIVA DE DÉBITOS",
          debitos_rfb: true,
          debitos_pgfn: false,
          tipo_certidao: null,
        },
      ],
    };
    const r = normalize(
      "receita-federal/pgfn",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
  });

  it("cascade: sem flags, certidao contém 'NEGATIVA' → negativa", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [
        {
          cpf: "12345678900",
          certidao: "CERTIDÃO NEGATIVA DE DÉBITOS",
        },
      ],
    };
    const r = normalize(
      "receita-federal/pgfn",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
  });
});

describe("normalize — CNDT", () => {
  it("conseguiu emitir + consta=false -> negativa", () => {
    const r = normalize("tribunal/tst/cndt", cndtNegativa as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
    expect(r.validade).toBe("11/10/2026");
  });

  it("consta=true -> positiva", () => {
    const custom = {
      code: 200,
      code_message: "ok",
      data: [
        {
          conseguiu_emitir_certidao_negativa: true,
          consta: true,
          mensagem: "Consta processo na 1a Vara",
        },
      ],
    };
    const r = normalize("tribunal/tst/cndt", custom as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
  });

  it("conseguiu=false -> nao_emitida", () => {
    const custom = {
      code: 200,
      code_message: "ok",
      data: [{ conseguiu_emitir_certidao_negativa: false }],
    };
    const r = normalize("tribunal/tst/cndt", custom as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("nao_emitida");
  });
});

describe("normalize — TRF Cert Unificada", () => {
  it("todos os 6 TRFs OK -> negativa", () => {
    const r = normalize(
      "tribunal/trf/cert-unificada",
      trfOk as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
  });

  it("um TRF falhou -> nao_emitida + detalhes mencionam qual", () => {
    const r = normalize(
      "tribunal/trf/cert-unificada",
      trfFail as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("nao_emitida");
    expect(r.detalhes).toContain("TRF3");
  });
});

describe("normalize — CEAT (TRT2/TRT15/TRT1/TRT4)", () => {
  it("consta=false -> negativa", () => {
    const r = normalize("tribunal/trt2/ceat", ceatNeg as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
  });

  it("consta=true -> positiva", () => {
    const custom = {
      code: 200,
      code_message: "ok",
      data: [{ consta: true, tipo: "Positiva" }],
    };
    const r = normalize("tribunal/trt15/ceat", custom as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
  });
});

describe("normalize — CENPROT SP", () => {
  it("lista vazia de protestos -> negativa", () => {
    const r = normalize("cenprot-sp/protestos", cenprotLimpo as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
  });

  it("lista com 1+ protestos -> positiva + conta no detalhe", () => {
    const r = normalize(
      "cenprot-sp/protestos",
      cenprotComProtesto as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
    expect(r.detalhes).toContain("1");
  });
});

describe("normalize — CENPROT Nacional (IEPTB)", () => {
  it("sem protestos -> negativa", () => {
    const r = normalize("ieptb/protestos", ieptbLimpo as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
    expect(r.detalhes).toContain("Nada consta");
  });

  it("com protestos -> positiva + contagem e breakdown por UF", () => {
    const r = normalize(
      "ieptb/protestos",
      ieptbComProtesto as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
    expect(r.detalhes).toContain("2 protesto");
    expect(r.detalhes).toContain("SP: 1");
    expect(r.detalhes).toContain("RJ: 1");
  });
});

describe("normalize — CENPROT Nacional Detalhes SP", () => {
  it("detalhes de cartório SP -> positiva com resumo", () => {
    const r = normalize(
      "ieptb/protestos-detalhes-sp",
      ieptbDetalhesSp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
    expect(r.detalhes).toContain("Tabelionato");
  });
});

describe("normalize — IPTU SP", () => {
  it("consta_debito=false -> negativa", () => {
    const r = normalize("pref/sp/sao-paulo/iptu", iptuSp as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("14/06/2026");
  });
});

describe("normalize — Matrícula ONR (ônus)", () => {
  it("imóvel com gravames → positiva + lista os ônus no detalhe", () => {
    const resp = {
      code: 200,
      code_message: "ok",
      data: [
        {
          numero_matricula: "12345",
          cartorio: "1º RI de São Paulo",
          tipo_certidao: "Inteiro Teor",
          tem_onus: true,
          ha_penhora: true,
          ha_alienacao_fiduciaria: true,
          ha_indisponibilidade: false,
          validade_ate: "01/08/2026",
        },
      ],
    };
    const r = normalize(
      "registradores/matric-pedido",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
    expect(r.detalhes).toContain("Matrícula 12345");
    expect(r.detalhes).toContain("penhora");
    expect(r.detalhes).toContain("alienação fiduciária");
    expect(r.detalhes).not.toContain("indisponibilidade");
  });

  it("imóvel livre → negativa + 'sem ônus'", () => {
    const resp = {
      code: 200,
      code_message: "ok",
      data: [
        {
          numero_matricula: "999",
          cartorio: "2º RI",
          tem_onus: false,
          ha_penhora: false,
          ha_alienacao_fiduciaria: false,
          ha_indisponibilidade: false,
        },
      ],
    };
    const r = normalize(
      "registradores/matric-download",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.detalhes).toContain("sem ônus");
  });
});

describe("normalize — Dados Cadastrais / Valor Venal SP", () => {
  it("extrai SQL, valor venal e área (informativa)", () => {
    const resp = {
      code: 200,
      code_message: "ok",
      data: [
        {
          numero_contribuinte: "123.456.7890-1",
          valor_venal: "850.000,00",
          area_construida: "85",
          uso: "Residencial",
        },
      ],
    };
    const r = normalize(
      "pref/sp/sao-paulo/dados-imovel",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("informativa");
    expect(r.detalhes).toContain("SQL 123.456.7890-1");
    expect(r.detalhes).toContain("Valor venal");
    expect(r.detalhes).toContain("85 m²");
    expect(r.detalhes).toContain("Residencial");
  });
});

describe("normalize — business errors (6xx)", () => {
  it("code 606 vira nao_emitida, nao crasha", () => {
    const r = normalize(
      "receita-federal/pgfn",
      businessError as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("nao_emitida");
    expect(r.detalhes).toContain("Nao foi possivel");
  });
});

describe("normalize — fallback para endpoint desconhecido", () => {
  it("endpoint sem extractor retorna shape minimo sem throw", () => {
    const resp = {
      code: 200,
      code_message: "ok",
      data: [{ tipo_certidao: "Negativa", data_validade: "01/01/2027" }],
    };
    const r = normalize("endpoint/inexistente", resp as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("01/01/2027");
  });
});

// Phase A — taxonomy of failure categories. Validates that each known code
// range resolves to the intended FailureCategory so the UI renders the right
// CTA (edit party vs. retry vs. contact admin).
describe("Phase A — failureCategory via normalize()", () => {
  it("code 612 (CPF invalido) → missing_input", () => {
    const r = normalize(
      "receita-federal/pgfn",
      pgfnMissing612 as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("nao_emitida");
    expect(r.failureCategory).toBe("missing_input");
  });

  it("code 614 (data nascimento divergente) → inconsistent_input", () => {
    const r = normalize(
      "receita-federal/pgfn",
      pgfnMismatch614 as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("nao_emitida");
    expect(r.failureCategory).toBe("inconsistent_input");
  });

  it("code 666 (portal fora) → portal_unavailable", () => {
    const r = normalize(
      "tribunal/tst/cndt",
      portal666 as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("nao_emitida");
    expect(r.failureCategory).toBe("portal_unavailable");
  });

  it("code 668 (quota diaria) → rate_limited", () => {
    const r = normalize(
      "tribunal/tst/cndt",
      rate668 as unknown as InfosimplesResponse
    );
    expect(r.failureCategory).toBe("rate_limited");
  });

  it("code 603 (sem saldo) → account_issue", () => {
    const r = normalize(
      "receita-federal/pgfn",
      noBalance603 as unknown as InfosimplesResponse
    );
    expect(r.failureCategory).toBe("account_issue");
  });

  it("code 600 (nenhum registro) → genuine_no_data + situacao=negativa", () => {
    const r = normalize(
      "receita-federal/pgfn",
      noData600 as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.failureCategory).toBe("genuine_no_data");
  });

  it("mapInfosimplesCodeToCategory fallback por mensagem", () => {
    // Código não mapeado mas mensagem contém 'saldo' → account_issue
    expect(mapInfosimplesCodeToCategory(999, "A conta esta sem saldo")).toBe(
      "account_issue"
    );
    // Código não mapeado, sem mensagem → fallback por range
    expect(mapInfosimplesCodeToCategory(610)).toBe("inconsistent_input");
    expect(mapInfosimplesCodeToCategory(672)).toBe("portal_unavailable");
    expect(mapInfosimplesCodeToCategory(999)).toBe("unknown");
  });

  // H.1 — Phase H (2026-04-18)
  describe("Phase H — code 602 TRF3/PGE-SP falso-negativo fix", () => {
    it("code 602 → integration_error (não genuine_no_data)", () => {
      expect(mapInfosimplesCodeToCategory(602)).toBe("integration_error");
    });

    it("TRF3 code 602 → situacao=nao_emitida (não negativa!)", () => {
      const r = normalize(
        "tribunal/trf3/certidao",
        trf3Code602 as unknown as InfosimplesResponse
      );
      expect(r.situacao).toBe("nao_emitida");
      expect(r.situacao).not.toBe("negativa"); // proteção explícita
      expect(r.failureCategory).toBe("integration_error");
      expect(r.consta_debito).toBe(false);
    });

    it("PGE-SP code 602 → situacao=nao_emitida", () => {
      const r = normalize(
        "pge-sp/cndt",
        pgeSpCode602 as unknown as InfosimplesResponse
      );
      expect(r.situacao).toBe("nao_emitida");
      expect(r.failureCategory).toBe("integration_error");
    });

    it("code 605 (timeout portal) → portal_unavailable", () => {
      // Phase H: 605 era genuine_no_data, agora portal_unavailable
      expect(mapInfosimplesCodeToCategory(605)).toBe("portal_unavailable");
    });

    it("code 615 (site indisponível) → portal_unavailable", () => {
      // Phase H (revisão): 615 era inconsistent_input ("name mismatch"),
      // mas Infosimples docs/prática dizem "site indisponível"
      expect(mapInfosimplesCodeToCategory(615)).toBe("portal_unavailable");
    });
  });
});

// H.4 complementar — categoria que emite PDF sem attachment
describe("Phase H — code 615 remapeado + categoria PDF", () => {
  it("code 615 com resposta → situacao=nao_emitida (categoria portal_unavailable)", () => {
    const resp = {
      code: 615,
      code_message: "O site está indisponível no momento. Tente novamente mais tarde.",
      data: [],
    };
    const r = normalize(
      "tribunal/trf/cert-unificada",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("nao_emitida");
    expect(r.failureCategory).toBe("portal_unavailable");
  });
});

// Phase B — novos extractors
describe("Phase B — Cartao CNPJ (receita-federal/cnpj)", () => {
  it("retorna situacao=informativa com razao social nos detalhes", () => {
    const r = normalize(
      "receita-federal/cnpj",
      receitaCnpj as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("informativa");
    expect(r.detalhes).toContain("EMPRESA EXEMPLO LTDA");
    expect(r.detalhes).toContain("Ativa");
    expect(r.consta_debito).toBe(false);
  });
});

describe("Phase B — CRF FGTS (caixa/regularidade)", () => {
  it("situacao Regular → negativa", () => {
    const r = normalize(
      "caixa/regularidade",
      caixaCrf as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("2026-06-15");
    expect(r.consta_debito).toBe(false);
  });

  it("situacao Irregular → positiva (tem debito)", () => {
    const custom = {
      code: 200,
      code_message: "OK",
      data: [
        {
          cnpj: "00000000000191",
          situacao: "Irregular",
          validade_inicio_data: "2026-04-16",
          validade_fim_data: null,
          mensagem: "Empresa possui debitos em aberto com FGTS",
        },
      ],
    };
    const r = normalize(
      "caixa/regularidade",
      custom as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
  });
});

describe("Phase B — Sefaz unificada (sefaz/certidao-debitos)", () => {
  it("conseguiu emitir + sem debito → negativa", () => {
    const r = normalize(
      "sefaz/certidao-debitos",
      sefazUnif as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("2026-10-13");
  });
});

describe("Phase B — novos TJs reusam tjExtractor", () => {
  it("TJBA primeiro-grau negativa", () => {
    const resp = {
      code: 200,
      code_message: "ok",
      data: [{ tipo_certidao: "Negativa", data_validade: "2026-10-01" }],
    };
    const r = normalize(
      "tribunal/tjba/primeiro-grau",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
  });

  it("TJGO nada consta", () => {
    const resp = {
      code: 200,
      code_message: "ok",
      data: [{ tipo_certidao: "Nada consta" }],
    };
    const r = normalize(
      "tribunal/tjgo/nada-consta",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
  });

  it("TRT3 CEAT negativa", () => {
    const resp = {
      code: 200,
      code_message: "ok",
      data: [{ consta: false, tipo: "Negativa" }],
    };
    const r = normalize(
      "tribunal/trt3/ceat",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
  });
});

// Phase K (2026-04-18) — gaps do Mapeamento_Certidoes.md
describe("Phase K — receita-federal/cpf (situação cadastral)", () => {
  it("Regular → informativa (não bloqueia)", async () => {
    const fixture = await import("../__fixtures__/receita-cpf-regular.json");
    const r = normalize(
      "receita-federal/cpf",
      fixture.default as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("informativa");
    expect(r.consta_debito).toBe(false);
    expect(r.detalhes).toContain("LEONARDO CORREIA QUIRINO");
  });

  it("Suspensa → positiva (bloqueia minuta)", async () => {
    const fixture = await import("../__fixtures__/receita-cpf-suspensa.json");
    const r = normalize(
      "receita-federal/cpf",
      fixture.default as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
    expect(r.detalhes).toContain("Suspensa");
  });
});

describe("Phase K — antecedentes-criminais/pf/emit", () => {
  it("Nada consta → negativa + validade", async () => {
    const fixture = await import(
      "../__fixtures__/antecedentes-pf-nada-consta.json"
    );
    const r = normalize(
      "antecedentes-criminais/pf/emit",
      fixture.default as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("16/07/2026");
    expect(r.consta_debito).toBe(false);
  });

  it("resultado 'CONSTA' sem flag bool → positiva", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ resultado: "CONSTA — Apuração em andamento" }],
    };
    const r = normalize(
      "antecedentes-criminais/pf/emit",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
  });
});

describe("Phase K — sncr/ccir", () => {
  it("Regular → negativa com metadata do imóvel", async () => {
    const fixture = await import("../__fixtures__/ccir-regular.json");
    const r = normalize(
      "sncr/ccir",
      fixture.default as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.detalhes).toContain("NIRF 1234567-8");
    expect(r.detalhes).toContain("Caçapava do Sul");
  });

  it("Em atraso → positiva", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ nirf: "999-9", situacao: "Em atraso", exercicio: "2026" }],
    };
    const r = normalize("sncr/ccir", resp as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
  });
});

describe("Phase K — registradores/matric (ONR)", () => {
  it("Sem ônus → negativa", async () => {
    const fixture = await import("../__fixtures__/matricula-onr-negativa.json");
    const r = normalize(
      "registradores/matric-download",
      fixture.default as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.detalhes).toContain("Matrícula 52447");
    expect(r.validade).toBe("17/05/2026");
  });

  it("Com indisponibilidade → positiva", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [
        {
          numero_matricula: "999",
          tem_onus: false,
          ha_indisponibilidade: true,
        },
      ],
    };
    const r = normalize(
      "registradores/matric-download",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
  });
});

describe("Phase L — ONR Mapa (pesquisa de bens) + municipal", () => {
  it("ONR Mapa com imóveis → informativa (não vira negativa/positiva)", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ imoveis: [{ cartorio: "1 RI", matricula: "10" }, { matricula: "20" }] }],
    };
    const r = normalize("onr/mapa-registro-imoveis", resp as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("informativa");
    expect(r.consta_debito).toBe(false);
    expect(r.detalhes).toContain("2 imóvel");
  });

  it("ONR Mapa sem imóveis → informativa 'nenhum imóvel'", () => {
    const resp = { code: 200, code_message: "OK", data: [{ imoveis: [] }] };
    const r = normalize("onr/mapa-registro-imoveis", resp as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("informativa");
    expect(r.detalhes).toContain("Nenhum");
  });

  it("CND municipal (Porto Alegre) negativa", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ conseguiu_emitir_certidao_negativa: true, consta_debito: false }],
    };
    const r = normalize("pref/rs/porto-alegre/cnd", resp as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
  });
});

describe("TJSP E-Proc lista (informativa)", () => {
  it("sem processos → negativa (nada consta)", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ total_registros_real: 0, lista_processos: [] }],
    };
    const r = normalize(
      "tribunal/tjsp/eproc-lista",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.consta_debito).toBe(false);
  });

  it("com processos → positiva + contagem", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [
        {
          total_registros_real: 3,
          lista_processos: [
            { numero_processo: "1" },
            { numero_processo: "2" },
          ],
        },
      ],
    };
    const r = normalize(
      "tribunal/tjsp/eproc-lista",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("positiva");
    expect(r.consta_debito).toBe(true);
    expect(r.detalhes).toContain("3");
  });
});

describe("CENPROT 'não constam protestos' (6xx sem PDF)", () => {
  it("cenprot-sp/protestos 612 → situacao negativa + genuine_no_data", () => {
    const resp = {
      code: 612,
      code_message: "A consulta não retornou dados",
      errors: [
        "Não constam protestos nos cartórios participantes, cuja abrangência em SP é de 100%",
      ],
      data: [],
    };
    const r = normalize(
      "cenprot-sp/protestos",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
    expect(r.failureCategory).toBe("genuine_no_data");
    expect(r.consta_debito).toBe(false);
  });

  it("ieptb/protestos 612 'nada consta' → situacao negativa", () => {
    const resp = {
      code: 612,
      code_message: "Nada consta",
      data: [],
    };
    const r = normalize(
      "ieptb/protestos",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).toBe("negativa");
  });

  it("PGFN 612 (não-protesto) NÃO é tratado como nada consta", () => {
    const resp = {
      code: 612,
      code_message: "CPF inválido",
      data: [],
    };
    const r = normalize(
      "receita-federal/pgfn",
      resp as unknown as InfosimplesResponse
    );
    expect(r.situacao).not.toBe("negativa");
    expect(r.failureCategory).toBe("missing_input");
  });
});
