import { describe, it, expect } from "vitest";
import { planCertidoesForDeal, diligentedPersonToInput } from "../planner";

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

  it("vendedora SP recebe UM TJSP pedido-civel (interim 2026-05-22 — endpoint é cível-only)", () => {
    const tjsp = plan.jobs.filter(
      (j) => j.targetKind === "vendedor" && j.endpoint === "tribunal/tjsp/pedido-civel"
    );
    // pedido-civel ignora tipo_certidao no input e sempre devolve "Ações Cíveis
    // em Geral" — disparar 4 tipos gerava 4 PDFs idênticos. Reduzido a 1.
    expect(tjsp).toHaveLength(1);
    expect(tjsp[0].requestPayload.tipo_certidao).toBe("civel");
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

  it("gera IPTU SP quando o imóvel tem SQL (Phase L — trilha reativada)", () => {
    const iptu = plan.jobs.find((j) => j.endpoint === "pref/sp/sao-paulo/iptu");
    expect(iptu).toBeDefined();
    expect(iptu?.targetKind).toBe("imovel");
    expect(iptu?.requestPayload.sql).toBe("123.456.0789-0");
  });

  it("matrícula ONR vira skip quando onrActive não está setado", () => {
    // sem onrActive (default), o pedido de matrícula é pulado com razão ONR.
    const job = plan.jobs.find((j) => j.endpoint === "registradores/matric/pedido");
    const skip = plan.skipped.find(
      (s) => s.endpoint === "registradores/matric/pedido"
    );
    expect(job).toBeUndefined();
    expect(skip).toBeDefined();
    expect(skip?.missingField).toBe("onr");
  });

  it("dispara E-Proc SP (lista) para vendedor SP — Infosimples cobre", () => {
    // 2026-05-21: E-Proc SP passou de SkippedJob → job real via
    // tribunal/tjsp/eproc-lista (consulta informativa por CPF/CNPJ).
    const eproc = plan.jobs.filter(
      (j) => j.endpoint === "tribunal/tjsp/eproc-lista"
    );
    expect(eproc.length).toBeGreaterThanOrEqual(1);
    // não deve mais aparecer como skip "sem cobertura"
    expect(
      plan.skipped.some((s) => s.endpoint.startsWith("tribunal/tjsp/eproc"))
    ).toBe(false);
  });

  it("custo total bate com a soma dos jobs", () => {
    const sum = plan.jobs.reduce((a, j) => a + j.costCents, 0);
    expect(plan.totalCostCents).toBe(sum);
  });
});

describe("planCertidoesForDeal — TJSP e-mail distinto por pedido (anti-604)", () => {
  // PF SP COM rg + sexo → pedido-certidao em 2 modelos (4 + 1). Cada pedido
  // precisa de um email_envio ÚNICO senão o e-SAJ recusa com 604 "mesmo email".
  const plan = planCertidoesForDeal({
    vendedores: [{ ...VENDEDOR_PF_SP, rg: "12345678", sexo: "F" }],
    compradores: [],
    imoveis: [],
  });

  it("gera 2 pedidos pedido-certidao para a PF com RG", () => {
    const cert = plan.jobs.filter(
      (j) =>
        j.endpoint === "tribunal/tjsp/pedido-certidao" &&
        j.targetKind === "vendedor"
    );
    expect(cert.length).toBe(2);
  });

  it("os 2 pedidos têm email_envio DISTINTO e em formato plus-alias", () => {
    const cert = plan.jobs.filter(
      (j) =>
        j.endpoint === "tribunal/tjsp/pedido-certidao" &&
        j.targetKind === "vendedor"
    );
    const emails = cert.map((j) => j.requestPayload.email_envio as string);
    expect(new Set(emails).size).toBe(emails.length); // todos distintos
    emails.forEach((e) => {
      expect(e).toMatch(/^[^@\s]+\+[a-z0-9]+@[^@\s]+$/i); // local+token@dominio
    });
  });

  // Edge-case 2026-06-03: a MESMA pessoa (mesmo CPF) em índices/papéis distintos
  // (ex.: PF vendedora que também representa uma PJ) não pode compartilhar alias
  // — o token inclui targetKind+índice. Aqui simulamos o mesmo CPF em 2 índices.
  it("mesmo CPF em índices diferentes → aliases TODOS distintos (sem colisão)", () => {
    const dup = { ...VENDEDOR_PF_SP, rg: "12345678", sexo: "F" };
    const p = planCertidoesForDeal({
      vendedores: [dup, dup],
      compradores: [],
      imoveis: [],
    });
    const emails = p.jobs
      .filter((j) => j.endpoint === "tribunal/tjsp/pedido-certidao")
      .map((j) => j.requestPayload.email_envio as string);
    expect(emails.length).toBe(4); // 2 partes × 2 modelos
    expect(new Set(emails).size).toBe(4); // todos distintos, apesar do mesmo CPF
  });
});

describe("planCertidoesForDeal — TRF individual (TRF5) envia birthdate (fix 2026-06-05)", () => {
  // Vendedor PF em PE → TRF5 (AL/CE/PB/PE/RN/SE). O endpoint exige `birthdate`
  // com CPF (606 "O parâmetro 'birthdate' deve ser preenchido quando o campo
  // 'CPF' for usado"). Antes o handler montava só cpf+nome → certidão acusava
  // "faltam dados" mesmo com a data no formulário.
  const plan = planCertidoesForDeal({
    vendedores: [
      {
        tipo_pessoa: "fisica" as const,
        nome: "Jose da Silva",
        cpf: "52998224725",
        data_nascimento: "1975-03-08",
        uf: "PE",
        cidade: "Recife",
      },
    ],
    compradores: [],
    imoveis: [],
  });

  it("os jobs TRF5 (Cível + Criminal) incluem birthdate normalizado", () => {
    const trf5 = plan.jobs.filter((j) => j.endpoint === "tribunal/trf5/certidao");
    expect(trf5.length).toBe(2);
    trf5.forEach((j) => {
      expect(j.requestPayload.cpf).toBe("52998224725");
      expect(j.requestPayload.birthdate).toBe("1975-03-08");
    });
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

  // Phase L (2026-05-22) — trilha de imóvel REATIVADA. IPTU/CND municipal
  // dispara quando o imóvel tem o identificador (SQL em SP, inscrição nas
  // demais); sem ele, vira SkippedJob com missingFields.
  it("imóvel SP com SQL gera IPTU SP; RJ com inscrição gera certidão tributária", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [
        { rua: "Rua X", cidade: "Sao Paulo", uf: "SP", sql: "123.456.0789-0" },
        { rua: "Rua Y", cidade: "Rio de Janeiro", uf: "RJ", inscricao_municipal: "99999" },
      ],
    });
    const iptuSp = plan.jobs.find((j) => j.endpoint === "pref/sp/sao-paulo/iptu");
    expect(iptuSp?.targetIndex).toBe(0);
    const certRj = plan.jobs.find((j) => j.endpoint === "pref/rj/rio-janeiro/cert-trib");
    expect(certRj?.targetIndex).toBe(1);
    expect(certRj?.requestPayload.inscricao).toBe("99999");
  });

  it("imóvel SP SEM SQL → IPTU SP vira skip com missingField sql", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [{ rua: "Rua X", cidade: "Sao Paulo", uf: "SP" }],
    });
    expect(plan.jobs.find((j) => j.endpoint === "pref/sp/sao-paulo/iptu")).toBeUndefined();
    const skip = plan.skipped.find((s) => s.endpoint === "pref/sp/sao-paulo/iptu");
    expect(skip?.missingField).toBe("sql");
  });

  it("município sem cobertura Infosimples → skip manual", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [{ rua: "Rua Z", cidade: "Vitoria", uf: "ES", inscricao_municipal: "1" }],
    });
    const skip = plan.skipped.find((s) => s.endpoint === "pref/municipal-manual");
    expect(skip).toBeDefined();
  });

  it("imóvel BH usa param `identificador` + intervalo de datas (não indice_cadastral)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [
        { rua: "Rua W", cidade: "Belo Horizonte", uf: "MG", inscricao_municipal: "55555" },
      ],
    });
    const bh = plan.jobs.find((j) => j.endpoint === "pref/mg/belo-horizonte/cndiptu");
    expect(bh).toBeDefined();
    expect(bh?.requestPayload.identificador).toBe("55555");
    expect(bh?.requestPayload.indice_cadastral).toBeUndefined();
    expect(typeof bh?.requestPayload.data_inicio).toBe("string");
    expect(typeof bh?.requestPayload.data_fim).toBe("string");
  });

  it("imóvel em Curitiba → trilha de imóvel sem cobertura (skip manual), mas CND por contribuinte do vendedor dispara pela REGIÃO DO IMÓVEL", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP], // endereço SP
      compradores: [],
      imoveis: [
        { rua: "Rua K", cidade: "Curitiba", uf: "PR", inscricao_municipal: "123" },
      ],
    });
    // Trilha de imóvel: Curitiba não tem certidão por-imóvel → skip manual.
    const skip = plan.skipped.find((s) => s.endpoint === "pref/municipal-manual");
    expect(skip).toBeDefined();
    // Redesign 2026-05-26: vendedor (SP) recebe a CND-por-contribuinte de
    // Curitiba porque o IMÓVEL está em Curitiba — região do imóvel, tier padrão.
    const cnd = plan.jobs.find((j) => j.endpoint === "pref/pr/curitiba/cnd");
    expect(cnd).toBeDefined();
    expect(cnd?.targetKind).toBe("vendedor");
    expect(cnd?.region?.kind).toBe("imovel");
    expect(cnd?.region?.uf).toBe("PR");
    expect(cnd?.tier).toBe("padrao");
  });

  it("parte de Curitiba dispara CND municipal por contribuinte (cpf)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "Fulano PR",
          cpf: "11144477735",
          uf: "PR",
          cidade: "Curitiba",
          data_nascimento: "1980-01-01",
        },
      ],
      compradores: [],
      imoveis: [],
    });
    const cwb = plan.jobs.find((j) => j.endpoint === "pref/pr/curitiba/cnd");
    expect(cwb).toBeDefined();
    expect(cwb?.targetKind).toBe("vendedor");
    expect(cwb?.requestPayload.cpf).toBe("11144477735");
  });

  it("matrícula ONR dispara com onrActive + matrícula presente", () => {
    const plan = planCertidoesForDeal(
      {
        vendedores: [VENDEDOR_PF_SP],
        compradores: [],
        imoveis: [
          { rua: "Rua X", cidade: "Sao Paulo", uf: "SP", matricula: "54321", cartorio: "1 RI SP" },
        ],
      },
      undefined,
      undefined,
      { onrActive: true }
    );
    const matric = plan.jobs.find((j) => j.endpoint === "registradores/matric/pedido");
    expect(matric).toBeDefined();
    expect(matric?.requestPayload.matricula).toBe("54321");
    // ONR exige `finalidade` NUMÉRICA (a API faz to_i; texto livre → 0 → 606).
    // Genérico "compra e venda" = 1, configurável via ONR_MATRIC_FINALIDADE.
    expect(matric?.requestPayload.finalidade).toBe(1);
    expect(typeof matric?.requestPayload.finalidade).toBe("number");
  });

  it("pesquisa de bens ONR (mapa): aparece para vendedor com onrActive (tier pesquisa, sem expandAll); skip sem credencial", () => {
    const base = {
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [],
    };
    // Redesign 2026-05-26: não depende mais de expandAll — aparece no plano
    // padrão como opção da camada "pesquisa" (desmarcada na UI) quando onrActive.
    const auto = planCertidoesForDeal(base, undefined, undefined, { onrActive: true });
    const bens = auto.jobs.find((j) => j.endpoint === "onr/mapa-registro-imoveis");
    expect(bens).toBeDefined();
    expect(bens?.tier).toBe("pesquisa");
    expect(bens?.targetKind).toBe("vendedor");
    // sem credencial ONR → vira skip (não some)
    const semOnr = planCertidoesForDeal(base, undefined, undefined, { onrActive: false });
    expect(
      semOnr.jobs.find((j) => j.endpoint === "onr/mapa-registro-imoveis")
    ).toBeUndefined();
    expect(
      semOnr.skipped.find((s) => s.endpoint === "onr/mapa-registro-imoveis")
    ).toBeDefined();
    // comprador NÃO recebe pesquisa de bens
    const comp = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [VENDEDOR_PF_SP], imoveis: [] },
      undefined,
      undefined,
      { onrActive: true }
    );
    expect(
      comp.jobs.find(
        (j) => j.endpoint === "onr/mapa-registro-imoveis" && j.targetKind === "comprador"
      )
    ).toBeUndefined();
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

  it("PJ em SP recebe TJSP pedido-certidao modelo 4 (Cível-Geral) + 1 (Falências)", () => {
    const tjsp = plan.jobs.filter(
      (j) => j.endpoint === "tribunal/tjsp/pedido-certidao" && j.targetKind === "vendedor"
    );
    expect(tjsp).toHaveLength(2);
    const modelos = new Set(tjsp.map((j) => j.requestPayload.modelo));
    expect(modelos).toEqual(new Set([4, 1]));
    tjsp.forEach((j) => {
      expect(j.requestPayload.cnpj).toBe("11222333000181");
      expect(j.requestPayload.razao_social).toBe("ACME Imobiliaria LTDA");
      expect(j.requestPayload.email_envio).toBeTruthy();
    });
    // PJ não usa pedido-civel
    expect(
      plan.jobs.some((j) => j.endpoint === "tribunal/tjsp/pedido-civel")
    ).toBe(false);
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

  it("parte PE dispara TRF5 com tipo_certidao NUMÉRICO '1'/'2' (não CIVEL/CRIMINAL)", () => {
    // 2026-05-25 — TRF5 exige tipo_certidao numérico (code 607 com CIVEL).
    const plan = planCertidoesForDeal({
      vendedores: [{ ...VENDEDOR_PF_SP, uf: "PE", cidade: "Recife" }],
      compradores: [],
      imoveis: [],
    });
    const trf5 = plan.jobs.filter((j) => j.endpoint === "tribunal/trf5/certidao");
    expect(trf5).toHaveLength(2);
    expect(new Set(trf5.map((j) => j.requestPayload.tipo_certidao))).toEqual(
      new Set(["1", "2"])
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

  it("parte SP com GOV.BR: dispara só o nacional (cenprot-sp suprimido por redundância)", () => {
    // Redesign 2026-05-26: quando o CENPROT Nacional (ieptb/protestos) dispara,
    // o cenprot-sp/protestos é redundante (Nacional cobre SP + detalhes-sp
    // encadeado) → suprimido. Sem GOV.BR, o SP-direto volta (teste abaixo).
    const plan = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] },
      undefined,
      undefined,
      { govBrActive: true }
    );
    expect(plan.jobs.find((j) => j.endpoint === "ieptb/protestos")).toBeDefined();
    expect(plan.jobs.find((j) => j.endpoint === "cenprot-sp/protestos")).toBeUndefined();
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

describe("Dependentes do vendedor (cônjuge / procurador / representante)", () => {
  const VENDEDOR_CASADO = {
    tipo_pessoa: "fisica" as const,
    nome: "Janser Pinheiro",
    cpf: "52998224725",
    data_nascimento: "1980-05-14",
    uf: "SP",
    cidade: "Indaiatuba",
    conjuge: {
      nome: "Priscila Pinheiro",
      cpf: "11144477735",
      data_nascimento: "1982-03-10",
      nome_mae: "Joana",
      endereco_igual_ao_titular: true,
    },
    procurador: {
      nome: "Dr. Advogado",
      cpf: "39053344705",
    },
  };

  it("vendedor casado gera jobs conjuge_vendedor (CPF do cônjuge, herda UF do titular)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_CASADO],
      compradores: [],
      imoveis: [],
    });
    const conj = plan.jobs.filter((j) => j.targetKind === "conjuge_vendedor");
    expect(conj.length).toBeGreaterThan(0);
    // targetIndex aponta para o vendedor titular (0)
    expect(conj.every((j) => j.targetIndex === 0)).toBe(true);
    const cpfJob = conj.find((j) => j.endpoint === "receita-federal/cpf");
    expect(cpfJob?.requestPayload.cpf).toBe("11144477735");
    // TJSP do cônjuge dispara porque herdou UF=SP do titular (1 pedido cível
    // após o interim 2026-05-22 — pedido-civel é cível-only).
    const tjsp = conj.filter((j) => j.endpoint === "tribunal/tjsp/pedido-civel");
    expect(tjsp.length).toBe(1);
  });

  it("procurador sem data_nascimento vira skip nos endpoints que a exigem", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_CASADO],
      compradores: [],
      imoveis: [],
    });
    const procJobs = plan.jobs.filter((j) => j.targetKind === "procurador_vendedor");
    const procSkips = plan.skipped.filter(
      (s) => s.targetKind === "procurador_vendedor"
    );
    // CNDT (não exige nascimento) deve sair; TJSP/PGFN/Receita-CPF viram skip.
    expect(procJobs.some((j) => j.endpoint === "tribunal/tst/cndt")).toBe(true);
    expect(
      procSkips.some((s) => s.endpoint === "tribunal/tjsp/pedido-civel")
    ).toBe(true);
    // basePath do skip aponta para vendedores.0.procurador
    const skip = procSkips.find((s) => s.missingFields.length > 0);
    if (skip) {
      expect(skip.missingFields[0].path).toContain("vendedores.0.procurador");
    }
  });

  it("COMPRADOR casado NÃO gera dependentes (decisão do usuário)", () => {
    // Vendedor SEM cônjuge; comprador COM cônjuge+procurador. Nenhum dependente
    // deve ser gerado (só vendedores enumeram dependentes).
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [VENDEDOR_CASADO],
      imoveis: [],
    });
    expect(plan.jobs.some((j) => j.targetKind === "conjuge_vendedor")).toBe(false);
    expect(plan.jobs.some((j) => j.targetKind === "procurador_vendedor")).toBe(false);
    expect(
      plan.jobs.some((j) => String(j.targetKind).includes("comprador") && j.targetKind !== "comprador")
    ).toBe(false);
  });

  it("vendedor PJ gera representante_vendedor PF (herda UF da empresa)", () => {
    const plan = planCertidoesForDeal({
      vendedores: [
        {
          ...PESSOA_JURIDICA,
          representante: {
            nome: "Sócio Assinante",
            cpf: "11144477735",
            data_nascimento: "1975-01-20",
            nome_mae: "Maria",
          },
        } as any,
      ],
      compradores: [],
      imoveis: [],
    });
    const rep = plan.jobs.filter((j) => j.targetKind === "representante_vendedor");
    expect(rep.length).toBeGreaterThan(0);
    const cpfJob = rep.find((j) => j.endpoint === "receita-federal/cpf");
    expect(cpfJob?.requestPayload.cpf).toBe("11144477735");
  });
});

describe("TJSP migração pedido-certidao (modelo numérico) — 2026-05-23", () => {
  const VENDEDOR_PF_SP_COM_RG = {
    tipo_pessoa: "fisica" as const,
    nome: "Maria Com RG",
    cpf: "52998224725",
    rg: "12.345.678-9",
    data_nascimento: "1980-05-14",
    sexo: "F",
    uf: "SP",
    cidade: "Sao Paulo",
  };

  it("PF SP COM rg + sexo → 2 pedido-certidao (modelo 4 + 1) com genero, sem pedido-civel", () => {
    const plan = planCertidoesForDeal({ vendedores: [VENDEDOR_PF_SP_COM_RG], compradores: [], imoveis: [] });
    const cert = plan.jobs.filter((j) => j.endpoint === "tribunal/tjsp/pedido-certidao");
    expect(cert).toHaveLength(2);
    expect(new Set(cert.map((j) => j.requestPayload.modelo))).toEqual(new Set([4, 1]));
    cert.forEach((j) => {
      expect(j.requestPayload.rg).toBe("12.345.678-9");
      expect(j.requestPayload.cpf).toBe("52998224725");
      expect(j.requestPayload.nome_completo).toBe("Maria Com RG");
      expect(j.requestPayload.genero).toBe("F");
      expect(j.requestPayload.email_envio).toBeTruthy();
    });
    expect(plan.jobs.some((j) => j.endpoint === "tribunal/tjsp/pedido-civel")).toBe(false);
  });

  it("PF SP COM rg SEM sexo → skip pedido-certidao(sexo), sem disparar", () => {
    const semSexo = { ...VENDEDOR_PF_SP_COM_RG, sexo: undefined };
    const plan = planCertidoesForDeal({ vendedores: [semSexo], compradores: [], imoveis: [] });
    expect(
      plan.jobs.some((j) => j.endpoint === "tribunal/tjsp/pedido-certidao")
    ).toBe(false);
    const sexoSkip = plan.skipped.find(
      (s) => s.endpoint === "tribunal/tjsp/pedido-certidao" && s.missingField === "sexo"
    );
    expect(sexoSkip).toBeDefined();
  });

  it("PF SP SEM rg (com data_nascimento) → fallback pedido-civel + skip pedido-certidao(rg)", () => {
    const plan = planCertidoesForDeal({ vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] });
    const civel = plan.jobs.filter((j) => j.endpoint === "tribunal/tjsp/pedido-civel");
    expect(civel).toHaveLength(1);
    expect(civel[0].requestPayload.tipo_certidao).toBe("civel");
    const rgSkip = plan.skipped.find(
      (s) => s.endpoint === "tribunal/tjsp/pedido-certidao" && s.missingField === "rg"
    );
    expect(rgSkip).toBeDefined();
    expect(rgSkip?.missingFields[0].path).toBe("vendedores.0.rg");
  });

  it("eproc-lista continua disparando independente do caminho", () => {
    const plan = planCertidoesForDeal({ vendedores: [VENDEDOR_PF_SP_COM_RG], compradores: [], imoveis: [] });
    expect(plan.jobs.some((j) => j.endpoint === "tribunal/tjsp/eproc-lista")).toBe(true);
  });
});

describe("Redesign 2026-05-26 — regiões (imóvel + endereço) e camadas (tier)", () => {
  const VENDEDOR_RJ = {
    tipo_pessoa: "fisica" as const,
    nome: "Joao do Rio",
    cpf: "52998224725",
    rg: "11.222.333-4",
    sexo: "M",
    data_nascimento: "1975-03-10",
    nome_mae: "Mae do Joao",
    uf: "RJ",
    cidade: "Rio de Janeiro",
  };
  const IMOVEL_SP = { rua: "Rua A", cidade: "Sao Paulo", uf: "SP", inscricao_municipal: "1" };

  it("vendedor RJ + imóvel SP → certidões regionais nas DUAS regiões (SP e RJ), tier padrão", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_RJ],
      compradores: [],
      imoveis: [IMOVEL_SP],
    });
    const vend = plan.jobs.filter((j) => j.targetKind === "vendedor");
    const regionUfs = new Set(
      vend.filter((j) => j.region?.kind !== "nacional").map((j) => j.region?.uf)
    );
    expect(regionUfs.has("SP")).toBe(true);
    expect(regionUfs.has("RJ")).toBe(true);
    // TRF de cada região: SP→trf3, RJ→trf2.
    expect(vend.some((j) => j.endpoint === "tribunal/trf3/certidao-distr" && j.region?.uf === "SP")).toBe(true);
    expect(vend.some((j) => j.endpoint === "tribunal/trf2/certidao" && j.region?.uf === "RJ")).toBe(true);
    // TJ de cada região: TJSP (SP) e TJRJ (RJ).
    expect(vend.some((j) => j.endpoint.includes("/tjsp/") && j.region?.uf === "SP")).toBe(true);
    expect(vend.some((j) => j.endpoint.includes("/tjrj/") && j.region?.uf === "RJ")).toBe(true);
    // Todos os jobs de vendedor são tier "padrao".
    expect(vend.every((j) => j.tier === "padrao")).toBe(true);
    // Federais aparecem uma vez, region nacional.
    const cndt = vend.filter((j) => j.endpoint === "tribunal/tst/cndt");
    expect(cndt).toHaveLength(1);
    expect(cndt[0].region?.kind).toBe("nacional");
  });

  it("dedup: vendedor SP + imóvel SP → não duplica certidões regionais", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [IMOVEL_SP],
    });
    const trf3 = plan.jobs.filter(
      (j) => j.targetKind === "vendedor" && j.endpoint === "tribunal/trf3/certidao-distr"
    );
    expect(trf3).toHaveLength(1);
  });

  it("comprador → tier opcional", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [VENDEDOR_RJ],
      imoveis: [IMOVEL_SP],
    });
    const comp = plan.jobs.filter((j) => j.targetKind === "comprador");
    expect(comp.length).toBeGreaterThan(0);
    expect(comp.every((j) => j.tier === "opcional")).toBe(true);
  });

  it("diligenciado (PJ adicionada manualmente) → tier padrão, pré-marcado no lote", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [IMOVEL_SP] },
      undefined,
      [
        {
          id: "dlg1",
          tipoPessoa: "juridica",
          nome: "DALLAMICO SISTEMAS LTDA",
          cpf: null,
          cnpj: "44814110000162",
          dataNascimento: null,
          uf: "SP",
          cidade: "Sao Vicente",
        },
      ]
    );
    const dlg = plan.jobs.filter((j) => j.targetKind === "diligenciado");
    expect(dlg.length).toBeGreaterThan(0);
    // Jobs PJ federais e regionais saem com CNPJ.
    expect(dlg.some((j) => j.endpoint === "receita-federal/pgfn")).toBe(true);
    // Pessoa adicionada manualmente = intenção explícita → padrão (pré-marcada,
    // incluída no "Só as que faltaram"). Pesquisa/Serasa continuam no próprio tier.
    expect(
      dlg.filter((j) => j.tier !== "pesquisa").every((j) => j.tier === "padrao")
    ).toBe(true);
  });

  it("IPTU/municipal do imóvel → tier imovel, region imovel", () => {
    const plan = planCertidoesForDeal({
      vendedores: [VENDEDOR_PF_SP],
      compradores: [],
      imoveis: [{ rua: "R", cidade: "Sao Paulo", uf: "SP", sql: "123.456.0789-0" }],
    });
    const iptu = plan.jobs.filter((j) => j.targetKind === "imovel");
    expect(iptu.length).toBeGreaterThan(0);
    expect(iptu.every((j) => j.tier === "imovel")).toBe(true);
    expect(iptu.every((j) => j.region?.kind === "imovel")).toBe(true);
  });

  it("Pesquisa de Bens (onr/mapa) → tier pesquisa (expandAll + onrActive)", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] },
      undefined,
      [],
      { expandAll: true, onrActive: true }
    );
    const bens = plan.jobs.filter((j) => j.endpoint === "onr/mapa-registro-imoveis");
    expect(bens.length).toBeGreaterThan(0);
    expect(bens.every((j) => j.tier === "pesquisa")).toBe(true);
  });

  it("extraRegions adiciona praça extra ao lado vendedor", () => {
    const plan = planCertidoesForDeal(
      { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] },
      undefined,
      [],
      { extraRegions: [{ uf: "RJ", cidade: "Rio de Janeiro" }] }
    );
    const vend = plan.jobs.filter((j) => j.targetKind === "vendedor");
    // Sem imóvel, regiões = endereço (SP) + extra (RJ).
    expect(vend.some((j) => j.endpoint.includes("/tjrj/"))).toBe(true);
    expect(vend.some((j) => j.region?.uf === "RJ")).toBe(true);
  });
});

describe("planCertidoesForDeal — diligenciado PF com rg/sexo/nome_mae (fix 2026-06-10)", () => {
  // Regressão: PF avulsa precisava de rg+sexo+nascimento pra gerar o TJSP
  // pedido-certidao (senão caía em skip "faltam dados"). diligentedPersonToInput
  // é a fonte única que carrega esses campos da row do Prisma pro planner —
  // antes cada rota tinha .map() inline e o dispatch esquecia rg/sexo, então a
  // certidão aparecia no popup mas era descartada ao emitir.
  const row = {
    id: "dp1",
    tipoPessoa: "fisica",
    nome: "Joana Avulsa",
    cpf: "52998224725",
    cnpj: null,
    dataNascimento: "1980-05-14",
    rg: "12345678",
    nomeMae: "Maria Avulsa",
    sexo: "feminino", // como o route grava (lowercase) — sexoToGenero normaliza p/ F
    uf: "SP",
    cidade: "Sao Paulo",
  };

  it("diligentedPersonToInput carrega rg/nomeMae/sexo da row do Prisma", () => {
    const input = diligentedPersonToInput(row);
    expect(input.rg).toBe("12345678");
    expect(input.nomeMae).toBe("Maria Avulsa");
    expect(input.sexo).toBe("feminino");
  });

  const plan = planCertidoesForDeal(
    { vendedores: [], compradores: [], imoveis: [] },
    undefined,
    [diligentedPersonToInput(row)]
  );

  it("gera TJSP pedido-certidao para o diligenciado PF (2 modelos), não skip", () => {
    const cert = plan.jobs.filter(
      (j) =>
        j.endpoint === "tribunal/tjsp/pedido-certidao" &&
        j.targetKind === "diligenciado"
    );
    expect(cert.length).toBe(2);
    // genero normalizado de "feminino" → "F" no payload
    cert.forEach((j) => expect(j.requestPayload.genero).toBe("F"));
    // e NÃO deve haver skip de TJSP por "faltam dados" pra esse alvo
    const skippedTjsp = plan.skipped.filter(
      (s) =>
        s.endpoint === "tribunal/tjsp/pedido-certidao" &&
        s.targetKind === "diligenciado"
    );
    expect(skippedTjsp.length).toBe(0);
  });

  it("carimba diligentedPersonId (âncora estável) nos jobs do diligenciado", () => {
    const diligJobs = plan.jobs.filter((j) => j.targetKind === "diligenciado");
    expect(diligJobs.length).toBeGreaterThan(0);
    diligJobs.forEach((j) => expect(j.diligentedPersonId).toBe("dp1"));
  });
});

describe("planCertidoesForDeal — diligentedPersonId só no diligenciado (fix FK 2026-06-11)", () => {
  // Vendedor (parte do form) NÃO recebe diligentedPersonId — ancoragem por id é só
  // pro diligenciado; partes do contrato seguem por targetIndex.
  const plan = planCertidoesForDeal(
    { vendedores: [VENDEDOR_PF_SP], compradores: [], imoveis: [] },
    undefined,
    [
      diligentedPersonToInput({
        id: "pessoaA",
        tipoPessoa: "juridica",
        nome: "ACME LTDA",
        cpf: null,
        cnpj: "11222333000181",
        dataNascimento: null,
        rg: null,
        nomeMae: null,
        sexo: null,
        uf: "SP",
        cidade: "Sao Paulo",
      }),
    ]
  );

  it("jobs de vendedor não têm diligentedPersonId", () => {
    const vend = plan.jobs.filter((j) => j.targetKind === "vendedor");
    expect(vend.length).toBeGreaterThan(0);
    vend.forEach((j) => expect(j.diligentedPersonId).toBeUndefined());
  });

  it("jobs do diligenciado carregam o id da pessoa", () => {
    const dilig = plan.jobs.filter((j) => j.targetKind === "diligenciado");
    expect(dilig.length).toBeGreaterThan(0);
    dilig.forEach((j) => expect(j.diligentedPersonId).toBe("pessoaA"));
  });
});
