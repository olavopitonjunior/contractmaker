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

describe("normalize — IPTU SP", () => {
  it("consta_debito=false -> negativa", () => {
    const r = normalize("pref/sp/sao-paulo/iptu", iptuSp as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("14/06/2026");
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
