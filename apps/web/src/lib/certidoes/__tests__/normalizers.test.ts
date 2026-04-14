import { describe, it, expect } from "vitest";
import { normalize } from "../normalizers";
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
