import { describe, it, expect } from "vitest";
import { planCertidoesForDeal } from "../planner";

const VENDEDOR_PF_SP = {
  tipo_pessoa: "fisica" as const,
  nome: "Maria Aparecida",
  cpf: "52998224725",
  data_nascimento: "1980-05-14",
  uf: "SP",
  cidade: "Sao Paulo",
};

const COMPRADOR_PF_RJ = {
  tipo_pessoa: "fisica" as const,
  nome: "Rafael Oliveira",
  cpf: "11144477735",
  data_nascimento: "1985-11-03",
  uf: "RJ",
  cidade: "Rio de Janeiro",
};

const PESSOA_JURIDICA = {
  tipo_pessoa: "juridica" as const,
  razao_social: "ACME Imobiliaria LTDA",
  cnpj: "11222333000181",
  uf: "SP",
  cidade: "Sao Paulo",
};

describe("planCertidoesForDeal — dados completos (PF SP + PF RJ + imovel SP)", () => {
  const plan = planCertidoesForDeal({
    vendedores: [VENDEDOR_PF_SP],
    compradores: [COMPRADOR_PF_RJ],
    imoveis: [
      {
        rua: "Rua das Palmeiras, 789",
        cidade: "Sao Paulo",
        uf: "SP",
        matricula: "54321",
        sql: "123.456.0789-0",
      },
    ],
  });

  it("gera jobs para os 3 endpoints federais por pessoa", () => {
    const pgfn = plan.jobs.filter((j) => j.endpoint === "receita-federal/pgfn");
    const cndt = plan.jobs.filter((j) => j.endpoint === "tribunal/tst/cndt");
    const trf = plan.jobs.filter((j) => j.endpoint === "tribunal/trf/cert-unificada");
    expect(pgfn).toHaveLength(2);
    expect(cndt).toHaveLength(2);
    expect(trf).toHaveLength(2);
  });

  it("PGFN PF inclui birthdate", () => {
    const pgfn = plan.jobs.find(
      (j) => j.endpoint === "receita-federal/pgfn" && j.targetKind === "vendedor"
    );
    expect(pgfn?.requestPayload.cpf).toBe("52998224725");
    expect(pgfn?.requestPayload.birthdate).toBe("1980-05-14");
  });

  it("vendedora SP recebe CEAT TRT2 fisico + digital + TRT15", () => {
    const ceats = plan.jobs.filter(
      (j) =>
        j.targetKind === "vendedor" &&
        (j.endpoint.startsWith("tribunal/trt2/") || j.endpoint === "tribunal/trt15/ceat")
    );
    expect(ceats).toHaveLength(3);
  });

  it("comprador RJ recebe TRT1 e nao TRT2/TRT15", () => {
    const trt1 = plan.jobs.filter(
      (j) => j.targetKind === "comprador" && j.endpoint === "tribunal/trt1/ceat"
    );
    const trt2 = plan.jobs.filter(
      (j) => j.targetKind === "comprador" && j.endpoint.startsWith("tribunal/trt2/")
    );
    expect(trt1).toHaveLength(1);
    expect(trt2).toHaveLength(0);
  });

  it("vendedora SP recebe TJSP pedido-civel", () => {
    const tjsp = plan.jobs.filter(
      (j) => j.targetKind === "vendedor" && j.endpoint === "tribunal/tjsp/pedido-civel"
    );
    expect(tjsp).toHaveLength(1);
  });

  it("comprador RJ recebe TJRJ pedido-cert com comarca derivada", () => {
    const tjrj = plan.jobs.find(
      (j) => j.targetKind === "comprador" && j.endpoint === "tribunal/tjrj/pedido-cert"
    );
    expect(tjrj).toBeDefined();
    expect(tjrj?.requestPayload.comarca).toBe("Capital");
    expect(tjrj?.requestPayload.tipo_certidao).toBe("civel");
  });

  // Phase F.II-α — imóvel removido do planner. CENPROT agora dispara por
  // parte PF/PJ (não mais por imóvel). IPTU/CND municipal não disparam mais.
  it("CENPROT SP dispara para vendedor PF em SP (remapeado de imóvel para pessoa)", () => {
    const cenprot = plan.jobs.find(
      (j) => j.endpoint === "cenprot-sp/protestos" && j.targetKind === "vendedor"
    );
    expect(cenprot).toBeDefined();
    expect(cenprot?.requestPayload.cpf).toBe("52998224725");
  });

  it("NÃO gera IPTU SP mesmo com SQL preenchido (Phase F.II-α)", () => {
    const iptu = plan.jobs.find((j) => j.endpoint === "pref/sp/sao-paulo/iptu");
    expect(iptu).toBeUndefined();
  });

  it("nao gera nada no skipped", () => {
    expect(plan.skipped).toHaveLength(0);
  });

  it("custo total bate com a soma dos jobs", () => {
    const sum = plan.jobs.reduce((a, j) => a + j.costCents, 0);
    expect(plan.totalCostCents).toBe(sum);
  });
});

describe("planCertidoesForDeal — dados faltando", () => {
  it("PF sem data_nascimento -> PGFN vai para skipped", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, data_nascimento: "" }],
      compradores: [],
      imoveis: [],
    });
    const pgfn = plan.jobs.find((j) => j.endpoint === "receita-federal/pgfn");
    const skipped = plan.skipped.find(
      (s) => s.endpoint === "receita-federal/pgfn"
    );
    expect(pgfn).toBeUndefined();
    expect(skipped).toBeDefined();
    expect(skipped?.missingField).toBe("data_nascimento");
  });

  it("PF sem CPF -> CNDT + TRF + PGFN viram skipped", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, cpf: "" }],
      compradores: [],
      imoveis: [],
    });
    const skippedEndpoints = new Set(plan.skipped.map((s) => s.endpoint));
    expect(skippedEndpoints.has("receita-federal/pgfn")).toBe(true);
    expect(skippedEndpoints.has("tribunal/tst/cndt")).toBe(true);
    expect(skippedEndpoints.has("tribunal/trf/cert-unificada")).toBe(true);
  });

  // Phase F.II-α — testes de imóvel removidos pois IPTU SP/RJ e CND
  // Municipal RJ foram retirados do planner (2026-04-16). Os endpoints
  // permanecem no catálogo mas o loop de imóveis foi removido. CENPROT
  // agora é testado em outro bloco (por parte PF/PJ).
  it("imóvel presente no form NÃO gera jobs de IPTU nem CND municipal", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [
        { rua: "Rua X", cidade: "Sao Paulo", uf: "SP", sql: "123.456.0789-0" },
        { rua: "Rua Y", cidade: "Rio de Janeiro", uf: "RJ", inscricao_municipal: "99999" },
      ],
    });
    expect(plan.jobs.find((j) => j.endpoint.startsWith("pref/"))).toBeUndefined();
    expect(plan.skipped.find((s) => s.endpoint.startsWith("pref/"))).toBeUndefined();
  });
});

describe("planCertidoesForDeal — pessoa juridica", () => {
  const plan = planCertidoesForDeal({
    vendedores: [PESSOA_JURIDICA],
    compradores: [],
    imoveis: [],
  });

  it("PJ nao exige data_nascimento", () => {
    const pgfn = plan.jobs.find((j) => j.endpoint === "receita-federal/pgfn");
    expect(pgfn).toBeDefined();
    expect(pgfn?.requestPayload.cnpj).toBe("11222333000181");
    expect(pgfn?.requestPayload.birthdate).toBeUndefined();
  });

  it("PJ em SP usa cnpj_raiz no CEAT digital", () => {
    const digital = plan.jobs.find(
      (j) => j.endpoint === "tribunal/trt2/ceat-digital"
    );
    expect(digital).toBeDefined();
    expect(digital?.requestPayload.cnpj_raiz).toBe("11222333");
  });

  it("PJ em SP recebe TJSP com razao_social + pais", () => {
    const tjsp = plan.jobs.find((j) => j.endpoint === "tribunal/tjsp/pedido-civel");
    expect(tjsp).toBeDefined();
    expect(tjsp?.requestPayload.razao_social).toBe("ACME Imobiliaria LTDA");
    expect(tjsp?.requestPayload.pais).toBe("Brasil");
  });
});

describe("planCertidoesForDeal — RS granular TJRS", () => {
  it("PF RS gera 5 jobs TJRS (um por tipo_certidao)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "RS", cidade: "Porto Alegre" }],
      compradores: [],
      imoveis: [],
    });
    const tjrs = plan.jobs.filter(
      (j) => j.endpoint === "tribunal/tjrs/primeiro-grau"
    );
    expect(tjrs).toHaveLength(5);
    const tipos = new Set(tjrs.map((j) => j.requestPayload.tipo_certidao));
    expect(tipos).toEqual(new Set([3, 4, 7, 8, 9]));
  });
});

describe("planCertidoesForDeal — deal vazio", () => {
  it("nao crasha com dataJson nulo", () => {
    const plan = planCertidoesForDeal(null);
    expect(plan.jobs).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.totalCostCents).toBe(0);
  });

  it("nao crasha com arrays vazios", () => {
    const plan = planCertidoesForDeal({ vendedores: [], compradores: [], imoveis: [] });
    expect(plan.jobs).toHaveLength(0);
  });
});

// Phase B — expansão regional: UFs novas + endpoints PJ
describe("Phase B — cobertura UF adicional (BA/GO/DF/SC/MT)", () => {
  it("parte PF em BA gera TJBA cível + TRT5 + sefaz unificada", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "BA", cidade: "Salvador" }],
      compradores: [],
      imoveis: [],
    });
    const tjba = plan.jobs.find((j) => j.endpoint === "tribunal/tjba/primeiro-grau");
    const trt5 = plan.jobs.find((j) => j.endpoint === "tribunal/trt5/ceat");
    const sefaz = plan.jobs.find((j) => j.endpoint === "sefaz/certidao-debitos");
    expect(tjba).toBeDefined();
    expect(trt5).toBeDefined();
    expect(sefaz).toBeDefined();
    expect(sefaz?.requestPayload.uf).toBe("BA");
  });

  it("parte PF em DF gera TJDF + 2 TRT10 (fisico+digital)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "DF", cidade: "Brasilia" }],
      compradores: [],
      imoveis: [],
    });
    const tjdf = plan.jobs.find((j) => j.endpoint === "tribunal/tjdf/nada-consta");
    const trt10Fisico = plan.jobs.find((j) => j.endpoint === "tribunal/trt10/ceat");
    const trt10Digital = plan.jobs.find((j) => j.endpoint === "tribunal/trt10/ceat-digital");
    expect(tjdf).toBeDefined();
    expect(trt10Fisico).toBeDefined();
    expect(trt10Digital).toBeDefined();
  });

  it("parte PF em MG (sem cobertura TJ) gera skip manual + TRT3", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "MG", cidade: "Belo Horizonte" }],
      compradores: [],
      imoveis: [],
    });
    const trt3 = plan.jobs.find((j) => j.endpoint === "tribunal/trt3/ceat");
    const skipTj = plan.skipped.find((s) => s.endpoint === "tribunal/tj-manual");
    expect(trt3).toBeDefined();
    expect(skipTj).toBeDefined();
    expect(skipTj?.reason).toContain("MG");
  });

  it("parte PF em estado sem CEAT gera skip trabalhista manual", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "PE", cidade: "Recife" }],
      compradores: [],
      imoveis: [],
    });
    const skipTrt = plan.skipped.find((s) => s.endpoint === "tribunal/trt-manual");
    expect(skipTrt).toBeDefined();
    expect(skipTrt?.reason).toContain("PE");
  });

  it("TJMT rejeita PJ com skip explicativo", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...PESSOA_JURIDICA, uf: "MT", cidade: "Cuiaba" }],
      compradores: [],
      imoveis: [],
    });
    const tjmtSkip = plan.skipped.find(
      (s) => s.endpoint === "tribunal/tjmt/primeiro-grau-pf"
    );
    expect(tjmtSkip).toBeDefined();
    expect(tjmtSkip?.reason).toContain("pessoa jur");
  });
});

describe("Phase B — PJ sempre dispara CNPJ + CRF", () => {
  it("parte PJ em SP gera receita-federal/cnpj + caixa/regularidade", () => {
    const plan = planCertidoesForDeal({
      vendedores: [PESSOA_JURIDICA],
      compradores: [],
      imoveis: [],
    });
    const cnpj = plan.jobs.find((j) => j.endpoint === "receita-federal/cnpj");
    const crf = plan.jobs.find((j) => j.endpoint === "caixa/regularidade");
    expect(cnpj).toBeDefined();
    expect(cnpj?.requestPayload.cnpj).toBe("11222333000181");
    expect(crf).toBeDefined();
    expect(crf?.requestPayload.cnpj).toBe("11222333000181");
  });

  it("parte PF NAO dispara CNPJ/CRF", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [],
    });
    expect(plan.jobs.find((j) => j.endpoint === "receita-federal/cnpj")).toBeUndefined();
    expect(plan.jobs.find((j) => j.endpoint === "caixa/regularidade")).toBeUndefined();
  });
});

describe("Phase B — CND Estadual roteamento", () => {
  it("SP usa pge-sp/cndt (específico)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [],
    });
    const spEp = plan.jobs.find((j) => j.endpoint === "pge-sp/cndt");
    expect(spEp).toBeDefined();
    expect(
      plan.jobs.find((j) => j.endpoint === "sefaz/certidao-debitos")
    ).toBeUndefined();
  });

  it("demais UFs usam sefaz/certidao-debitos unificada com UF no payload", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "BA", cidade: "Salvador" }],
      compradores: [],
      imoveis: [],
    });
    const sefaz = plan.jobs.find((j) => j.endpoint === "sefaz/certidao-debitos");
    expect(sefaz?.requestPayload.uf).toBe("BA");
  });
});
