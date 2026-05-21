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

  it("gera jobs para os 3 endpoints federais (PGFN + CNDT + TRF unificada) por pessoa", () => {
    // J.1 (Phase J, 2026-04-18) — reverteu o skip default do I.4. Princípio:
    // toda certidão solicitada é tentada; falha permanente vira failed com
    // portalUrl no cache do job.
    const pgfn = plan.jobs.filter((j) => j.endpoint === "receita-federal/pgfn");
    const cndt = plan.jobs.filter((j) => j.endpoint === "tribunal/tst/cndt");
    const trf = plan.jobs.filter(
      (j) => j.endpoint === "tribunal/trf/cert-unificada"
    );
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

  it("vendedora SP recebe TJSP pedido-civel multi-tipo (4 chamadas Phase F.II-γ)", () => {
    const tjsp = plan.jobs.filter(
      (j) => j.targetKind === "vendedor" && j.endpoint === "tribunal/tjsp/pedido-civel"
    );
    // Phase F.II-γ: 4 tipos (cível, família, falência, execução fiscal)
    // I.1 (Phase I, 2026-04-18): "familia-sucessoes" → "familia" (Infosimples
    // rejeitava valor com hífen composto com code 606).
    expect(tjsp).toHaveLength(4);
    const tipos = new Set(tjsp.map((j) => j.requestPayload.tipo_certidao));
    expect(tipos).toEqual(
      new Set(["civel", "familia", "falencia", "execucao-fiscal"])
    );
  });

  it("comprador RJ recebe TJRJ pedido-cert multi-tipo (4 chamadas) com comarca derivada", () => {
    const tjrj = plan.jobs.filter(
      (j) => j.targetKind === "comprador" && j.endpoint === "tribunal/tjrj/pedido-cert"
    );
    expect(tjrj).toHaveLength(4);
    // Todos devem ter comarca "Capital" (Rio de Janeiro)
    tjrj.forEach((j) => expect(j.requestPayload.comarca).toBe("Capital"));
    const tipos = new Set(tjrj.map((j) => j.requestPayload.tipo_certidao));
    expect(tipos).toEqual(
      new Set(["civel", "familia", "falencia", "execucao-fiscal"])
    );
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

  it("gera SkippedJob de E-Proc SP para vendedor SP (Phase F.II-γ)", () => {
    const eproc = plan.skipped.filter(
      (s) => s.endpoint === "tribunal/tjsp/eproc"
    );
    // 1 skip por parte SP (vendedor SP). Comprador RJ não dispara E-Proc SP.
    expect(eproc.length).toBeGreaterThanOrEqual(1);
    expect(eproc[0].externalLink).toBe("https://certidoes.tjsp.jus.br");
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

// J.1 (Phase J, 2026-04-18) — TRF unificada + TRF individual voltam ao plano
// default. Falhas serão tratadas pelo outcome-classifier (retry auto ou
// failed_permanent com portalUrl).
describe("Phase J — TRF unificada + TRF individual no plano default", () => {
  it("plano default: parte SP dispara TRF unificada E TRF3 individual (2-step, tipo=1)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [],
    });
    expect(plan.jobs.find((j) => j.endpoint === "tribunal/trf/cert-unificada")).toBeDefined();
    const trf3 = plan.jobs.find((j) => j.endpoint === "tribunal/trf3/certidao-distr");
    expect(trf3).toBeDefined();
    expect(trf3?.requestPayload.cpf).toBe("52998224725");
    // TRF3 usa `tipo` numérico (Infosimples doc) — 1 = Cível
    expect(trf3?.requestPayload.tipo).toBe(1);
  });

  it("parte BA dispara TRF1 (CIVEL+CRIMINAL) e não TRF2/TRF3", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "BA", cidade: "Salvador" }],
      compradores: [],
      imoveis: [],
    });
    const trf1 = plan.jobs.filter((j) => j.endpoint === "tribunal/trf1/certidao");
    expect(trf1).toHaveLength(2);
    const tipos = new Set(trf1.map((j) => j.requestPayload.tipo_certidao));
    expect(tipos).toEqual(new Set(["CIVEL", "CRIMINAL"]));
    expect(plan.jobs.find((j) => j.endpoint === "tribunal/trf3/certidao-distr")).toBeUndefined();
  });

  it("parte MG dispara TRF6 CIVEL + CRIMINAL (2 jobs com tipo_certidao)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "MG", cidade: "Belo Horizonte" }],
      compradores: [],
      imoveis: [],
    });
    const trf6 = plan.jobs.filter((j) => j.endpoint === "tribunal/trf6/certidao");
    expect(trf6).toHaveLength(2);
    expect(new Set(trf6.map((j) => j.requestPayload.tipo_certidao))).toEqual(
      new Set(["CIVEL", "CRIMINAL"])
    );
  });
});

describe("Phase K — Receita CPF exige birthdate (fix 2026-05-19)", () => {
  it("PF sem data_nascimento -> Receita CPF vai pra skipped", () => {
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, data_nascimento: "" }],
      compradores: [],
      imoveis: [],
    });
    expect(plan.jobs.find((j) => j.endpoint === "receita-federal/cpf")).toBeUndefined();
    const skipped = plan.skipped.find((s) => s.endpoint === "receita-federal/cpf");
    expect(skipped).toBeDefined();
    expect(skipped?.missingField).toBe("data_nascimento");
  });
});

describe("Phase F.II-γ — CENPROT Nacional com pre-flight GOV.BR", () => {
  it("govBrActive=false + parte fora de SP gera SkippedJob com reason GOV.BR", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [{ ...VENDEDOR_PF_SP, uf: "BA", cidade: "Salvador" }], compradores: [], imoveis: [] },
      undefined,
      undefined,
      { govBrActive: false }
    );
    const nacional = plan.skipped.find((s) => s.endpoint === "ieptb/protestos");
    expect(nacional).toBeDefined();
    expect(nacional?.missingField).toBe("govbr");
  });

  it("govBrActive=true + parte fora de SP gera JOB normal", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [{ ...VENDEDOR_PF_SP, uf: "BA", cidade: "Salvador" }], compradores: [], imoveis: [] },
      undefined,
      undefined,
      { govBrActive: true }
    );
    const nacional = plan.jobs.find((j) => j.endpoint === "ieptb/protestos");
    expect(nacional).toBeDefined();
  });

  it("parte SP dispara nacional E cenprot-sp local (2026-05-21: nacional p/ todos)", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] },
      undefined,
      undefined,
      { govBrActive: true }
    );
    expect(plan.jobs.find((j) => j.endpoint === "ieptb/protestos")).toBeDefined();
    expect(plan.jobs.find((j) => j.endpoint === "cenprot-sp/protestos")).toBeDefined();
  });

  it("govBrActive=false + parte SP também gera SkippedJob nacional (gate vale p/ todos)", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] },
      undefined,
      undefined,
      { govBrActive: false }
    );
    const nacional = plan.skipped.find((s) => s.endpoint === "ieptb/protestos");
    expect(nacional).toBeDefined();
    expect(nacional?.missingField).toBe("govbr");
    // CENPROT SP direto continua disparando (não depende de GOV.BR).
    expect(plan.jobs.find((j) => j.endpoint === "cenprot-sp/protestos")).toBeDefined();
  });

  it("nacional NÃO é planejado como job standalone para detalhes-sp (encadeado no executor)", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] },
      undefined,
      undefined,
      { govBrActive: true }
    );
    expect(
      plan.jobs.find((j) => j.endpoint === "ieptb/protestos-detalhes-sp")
    ).toBeUndefined();
  });
});

describe("Phase B — CND Estadual roteamento", () => {
  it("SP usa sefaz/certidao-debitos unificado (pge-sp/cndt depreciado — I.3)", () => {
    // I.3 (Phase I, 2026-04-18): pge-sp/cndt retornou 602 em 100% no QA
    // 2026-04-18. Depreciado, fallback para sefaz unificado.
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [],
    });
    expect(plan.jobs.find((j) => j.endpoint === "pge-sp/cndt")).toBeUndefined();
    const sefaz = plan.jobs.find((j) => j.endpoint === "sefaz/certidao-debitos");
    expect(sefaz).toBeDefined();
    expect(sefaz?.requestPayload.uf).toBe("SP");
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

// Phase K (2026-04-18) — CPF situação + Antecedentes PF em financiamento
describe("Phase K — receita-federal/cpf dispara sempre para PF", () => {
  it("vendedor PF gera job CPF situação", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [],
    });
    const cpfJob = plan.jobs.find((j) => j.endpoint === "receita-federal/cpf");
    expect(cpfJob).toBeDefined();
    expect(cpfJob?.requestPayload.cpf).toBe("52998224725");
    expect(cpfJob?.requestPayload.birthdate).toBe("1980-05-14");
  });

  it("PJ NÃO gera job CPF situação", () => {
    const plan = planCertidoesForDeal({
      vendedores: [PESSOA_JURIDICA],
      compradores: [],
      imoveis: [],
    });
    expect(
      plan.jobs.find((j) => j.endpoint === "receita-federal/cpf")
    ).toBeUndefined();
  });
});

describe("Phase K — antecedentes-criminais-pf em financiamento", () => {
  it("NÃO dispara quando modalidade não é financiamento", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [],
      modalidade: "a_vista",
    });
    expect(
      plan.jobs.find((j) => j.endpoint === "antecedentes-criminais/pf/emit")
    ).toBeUndefined();
  });

  it("dispara quando modalidade='financiamento' e PF tem data_nascimento + nome_mae", () => {
    const plan = planCertidoesForDeal({
      vendedores: [
        { ...VENDEDOR_PF_SP, nome_mae: "Ana Aparecida Souza" },
      ],
      compradores: [],
      imoveis: [],
      modalidade: "financiamento",
    });
    const ac = plan.jobs.find(
      (j) => j.endpoint === "antecedentes-criminais/pf/emit"
    );
    expect(ac).toBeDefined();
    expect(ac?.requestPayload.nome_mae).toBe("Ana Aparecida Souza");
    // Infosimples espera `birthdate` (ISO 8601), não `data_nascimento`
    expect(ac?.requestPayload.birthdate).toBe("1980-05-14");
  });

  it("skipped com missing_fields quando financiamento mas falta nome_mae", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP], // sem nome_mae
      compradores: [],
      imoveis: [],
      modalidade: "financiamento",
    });
    expect(
      plan.jobs.find((j) => j.endpoint === "antecedentes-criminais/pf/emit")
    ).toBeUndefined();
    const skip = plan.skipped.find(
      (s) => s.endpoint === "antecedentes-criminais/pf/emit"
    );
    expect(skip).toBeDefined();
    expect(skip?.reason).toContain("nome_mae");
  });
});
