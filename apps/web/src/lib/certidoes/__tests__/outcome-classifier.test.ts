import { describe, it, expect, vi } from "vitest";
import { classifyOutcome, parseMissingFields } from "../outcome-classifier";
import type { EndpointInfo } from "../endpoints";
import type { InfosimplesResponse, NormalizedResult } from "../types";

const baseEndpoint: EndpointInfo = {
  id: "tribunal/tjsp/pedido-civel",
  label: "TJSP Civel",
  costCents: 6,
  scope: "estadual",
  uf: "SP",
  appliesTo: ["pessoa"],
  category: "civel",
  portalUrl: "https://esaj.tjsp.jus.br/",
};

const informativeEndpoint: EndpointInfo = {
  id: "receita-federal/cnpj",
  label: "Cartao CNPJ",
  costCents: 4,
  scope: "federal",
  appliesTo: ["pessoa"],
  category: "cadastro",
};

const normEmpty: NormalizedResult = {
  situacao: "indeterminado",
  validade: null,
  emissao: null,
  detalhes: null,
  consta_debito: false,
};

describe("parseMissingFields", () => {
  it("extrai 'data_nascimento' de mensagem de obrigatório", () => {
    expect(
      parseMissingFields(
        "Parâmetros obrigatórios: data_nascimento, nome_mae"
      )
    ).toEqual(["data_nascimento", "nome_mae"]);
  });

  it("identifica CPF inválido", () => {
    expect(parseMissingFields("O campo CPF é inválido")).toContain("cpf");
  });

  it("identifica nome_mae em 'nome da mãe'", () => {
    expect(parseMissingFields("Informe o nome da mãe")).toContain("nome_mae");
  });
});

describe("classifyOutcome — Phase J", () => {
  const opts = { attachmentId: null, retryAttempts: 0, maxRetries: 3 };

  it("cadastro 200 → informativo (não success)", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ razao_social: "Empresa LTDA" }],
      header: { billable: true },
    } as unknown as InfosimplesResponse;
    const norm: NormalizedResult = {
      situacao: "informativa",
      validade: null,
      emissao: null,
      detalhes: "Empresa LTDA",
      consta_debito: false,
    };
    const out = classifyOutcome(resp, norm, informativeEndpoint, opts);
    expect(out.status).toBe("informativo");
    expect(out.costCents).toBe(4);
  });

  it("eproc-lista 612 'Nenhum Resultado' → success (informativo sem PDF, não failed_permanent)", () => {
    const eprocLista: EndpointInfo = {
      id: "tribunal/tjsp/eproc-lista",
      label: "E-Proc SP",
      costCents: 6,
      scope: "estadual",
      uf: "SP",
      appliesTo: ["pessoa"],
      category: "civel",
      emitsPdf: false,
      portalUrl: "https://esaj.tjsp.jus.br/",
    };
    const resp = {
      code: 612,
      code_message:
        "Nenhum Resultado Encontrado. (A consulta não retornou dados no site ou aplicativo de origem no qual a automação foi executada.)",
      data: [],
      header: { billable: false },
    } as unknown as InfosimplesResponse;
    const out = classifyOutcome(resp, normEmpty, eprocLista, opts);
    expect(out.status).toBe("success");
    expect(out.failureCategory).toBeNull();
  });

  it("612 'CPF inválido' em endpoint que EMITE PDF não é mascarado como success", () => {
    const resp = {
      code: 612,
      code_message: "O número de CPF informado é inválido.",
      data: [],
      header: { billable: true },
    } as unknown as InfosimplesResponse;
    const norm: NormalizedResult = {
      ...normEmpty,
      detalhes: "O número de CPF informado é inválido.",
      failureCategory: "missing_input" as const,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).not.toBe("success");
  });

  it("code 606 → data_missing + missingFields", () => {
    const resp = {
      code: 606,
      code_message: "Parâmetros obrigatórios: data_nascimento",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "missing_input" as const,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).toBe("data_missing");
    expect(out.missingFields).toContain("data_nascimento");
    expect(out.nextRetryAt).toBeNull(); // NÃO retry auto
    expect(out.costCents).toBe(0);
  });

  // I.6 (2026-05-11) — fallback para 606 genérico (TJSP padrão)
  it("code 606 genérico + portalUrl → failed_permanent com CTA portal", () => {
    const resp = {
      code: 606,
      code_message:
        "Parâmetros obrigatórios não foram enviados. Por favor, verifique a documentação de uso do serviço.",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "missing_input" as const,
      detalhes: resp.code_message, // o normalizer real preenche assim
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).toBe("failed_permanent");
    expect(out.missingFields).toEqual([]);
    expect(out.portalUrl).toBe("https://esaj.tjsp.jus.br/");
    expect(out.errorMessage).toMatch(/Parâmetros obrigatórios/);
    expect(out.failureCategory).toBe("missing_input"); // mantém categoria pra analytics
    expect(out.nextRetryAt).toBeNull();
  });

  // I.7 (2026-05-11) — Infosimples errors[] propagado no errorMessage
  it("code 606 com errors[] específico → failed_permanent com mensagem rica", () => {
    const resp = {
      code: 606,
      code_message: "Parâmetros obrigatórios não foram enviados",
      errors: ["CPF e senha ou certificado digital devem ser informados para login com gov.br"],
      data: [],
    } as unknown as InfosimplesResponse;
    // O normalizer real consolida errors + code_message em detalhes
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "missing_input" as const,
      detalhes:
        "CPF e senha ou certificado digital devem ser informados para login com gov.br (Parâmetros obrigatórios não foram enviados)",
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).toBe("failed_permanent");
    expect(out.errorMessage).toMatch(/login com gov\.br/);
    expect(out.portalUrl).toBe("https://esaj.tjsp.jus.br/");
  });

  it("code 606 genérico sem portalUrl → continua data_missing (sem fallback)", () => {
    const endpointSemPortal: EndpointInfo = {
      ...baseEndpoint,
      portalUrl: undefined,
    };
    const resp = {
      code: 606,
      code_message: "Parâmetros obrigatórios não foram enviados",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "missing_input" as const,
    };
    const out = classifyOutcome(resp, norm, endpointSemPortal, opts);
    expect(out.status).toBe("data_missing");
    expect(out.portalUrl).toBeNull();
  });

  it("code 614 → data_invalid + portalUrl presente", () => {
    const resp = {
      code: 614,
      code_message: "Data de nascimento não confere",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "inconsistent_input" as const,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).toBe("data_invalid");
    expect(out.nextRetryAt).toBeNull();
    expect(out.portalUrl).toBe("https://esaj.tjsp.jus.br/");
  });

  it("code 615 → portal_unavailable com retry agendado", () => {
    const resp = {
      code: 615,
      code_message: "Site indisponível",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "portal_unavailable" as const,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).toBe("portal_unavailable");
    expect(out.nextRetryAt).toBeInstanceOf(Date);
    // backoff inicial 10min
    const delta = out.nextRetryAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(9 * 60_000);
    expect(delta).toBeLessThan(11 * 60_000);
  });

  it("code 602 → failed_permanent (endpoint depreciado)", () => {
    const resp = {
      code: 602,
      code_message: "URL inválida",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "integration_error" as const,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).toBe("failed_permanent");
    expect(out.nextRetryAt).toBeNull(); // não adianta retry
    expect(out.portalUrl).toBe("https://esaj.tjsp.jus.br/");
  });

  it("code 668 (rate limit) → rate_limited com retry", () => {
    const resp = {
      code: 668,
      code_message: "Quota diária excedida",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "rate_limited" as const,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    expect(out.status).toBe("rate_limited");
    expect(out.nextRetryAt).toBeInstanceOf(Date);
  });

  it("retries esgotados → failed_permanent", () => {
    const resp = {
      code: 615,
      code_message: "Site indisponível",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "portal_unavailable" as const,
    };
    // attempts=3 já atingiu o max
    const out = classifyOutcome(resp, norm, baseEndpoint, {
      ...opts,
      retryAttempts: 3,
    });
    expect(out.status).toBe("failed_permanent");
    expect(out.nextRetryAt).toBeNull();
    expect(out.portalUrl).toBe("https://esaj.tjsp.jus.br/");
  });

  it("code 200 + negativa + sem PDF (endpoint que emite) → retry", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ tipo_certidao: "Negativa" }],
      site_receipts: [],
      header: { billable: true },
    } as unknown as InfosimplesResponse;
    const norm: NormalizedResult = {
      situacao: "negativa",
      validade: "14/10/2026",
      emissao: "14/04/2026",
      detalhes: "Negativa",
      consta_debito: false,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, opts);
    // endpoint exige PDF, mas não veio — retry como portal_unavailable
    expect(out.status).toBe("portal_unavailable");
    expect(out.nextRetryAt).toBeInstanceOf(Date);
  });

  it("code 200 + negativa + PDF presente → success", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ tipo_certidao: "Negativa" }],
      site_receipts: ["https://..."],
      header: { billable: true },
    } as unknown as InfosimplesResponse;
    const norm: NormalizedResult = {
      situacao: "negativa",
      validade: "14/10/2026",
      emissao: "14/04/2026",
      detalhes: "Negativa",
      consta_debito: false,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, {
      ...opts,
      attachmentId: "att_123",
    });
    expect(out.status).toBe("success");
    expect(out.costCents).toBe(6);
  });

  it("billable: false zera costCents", () => {
    const resp = {
      code: 200,
      code_message: "OK",
      data: [{ tipo_certidao: "Negativa" }],
      site_receipts: ["https://..."],
      header: { billable: false },
    } as unknown as InfosimplesResponse;
    const norm: NormalizedResult = {
      situacao: "negativa",
      validade: null,
      emissao: null,
      detalhes: "Negativa",
      consta_debito: false,
    };
    const out = classifyOutcome(resp, norm, baseEndpoint, {
      ...opts,
      attachmentId: "att_xxx",
    });
    expect(out.status).toBe("success");
    expect(out.costCents).toBe(0);
  });

  // 2026-05-21 — CENPROT "não constam protestos" (code 612, sem PDF) → negativa
  const cenprotEndpoint: EndpointInfo = {
    id: "cenprot-sp/protestos",
    label: "CENPROT SP (Protestos)",
    costCents: 6,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa", "imovel"],
    category: "protesto",
    portalUrl: "https://www.pesquisaprotestosp.com.br",
  };

  it("CENPROT 612 'não constam protestos' → success (negativa, sem PDF)", () => {
    const resp = {
      code: 612,
      code_message: "A consulta não retornou dados",
      errors: [
        "Não constam protestos nos cartórios participantes, cuja abrangência em SP é de 100%",
      ],
      data: [],
      header: { billable: true },
    } as unknown as InfosimplesResponse;
    // normalizer real marca situacao negativa + genuine_no_data nesse caso
    const norm = {
      ...normEmpty,
      situacao: "negativa" as const,
      failureCategory: "genuine_no_data" as const,
      detalhes: "Nada consta — sem protestos registrados",
    };
    const out = classifyOutcome(resp, norm, cenprotEndpoint, opts);
    expect(out.status).toBe("success");
    expect(out.failureCategory).toBeNull();
    expect(out.costCents).toBe(6);
    expect(out.nextRetryAt).toBeNull();
  });

  it("CENPROT 612 'não constam protestos' + billable false → success custo 0", () => {
    const resp = {
      code: 612,
      code_message: "A consulta não retornou dados",
      errors: ["Não constam protestos nos cartórios participantes"],
      data: [],
      header: { billable: false },
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "negativa" as const,
      failureCategory: "genuine_no_data" as const,
      detalhes: "Nada consta — sem protestos registrados",
    };
    const out = classifyOutcome(resp, norm, cenprotEndpoint, opts);
    expect(out.status).toBe("success");
    expect(out.costCents).toBe(0);
  });

  it("CENPROT erro de transporte (fetch failed) NÃO vira success", () => {
    const resp = {
      code: 605,
      code_message: "O site ou aplicativo de origem parece estar indisponível.",
      data: [],
    } as unknown as InfosimplesResponse;
    const norm = {
      ...normEmpty,
      situacao: "nao_emitida" as const,
      failureCategory: "portal_unavailable" as const,
      detalhes: "O site ou aplicativo de origem parece estar indisponível.",
    };
    const out = classifyOutcome(resp, norm, cenprotEndpoint, opts);
    expect(out.status).not.toBe("success");
    expect(out.status).toBe("portal_unavailable");
  });
});

describe("classifyOutcome — TJSP email throttle (604) — espaçar retries", () => {
  const tjspPedido: EndpointInfo = {
    id: "tribunal/tjsp/pedido-certidao",
    label: "TJSP Pedido",
    costCents: 6,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "civel",
    portalUrl: "https://esaj.tjsp.jus.br/",
  };
  const EMAIL_THROTTLE =
    "Não é possível utilizar o mesmo email múltiplas vezes num intervalo curto de tempo. Aguarde, ou tente novamente com outro email.";
  const resp604 = {
    code: 604,
    code_message: "A consulta não foi validada antes de pesquisar a fonte de origem.",
    data: [],
  } as unknown as InfosimplesResponse;
  const normEmail = (): NormalizedResult => ({
    ...normEmpty,
    situacao: "nao_emitida",
    failureCategory: "rate_limited",
    detalhes: EMAIL_THROTTLE,
  });

  it("attempt 0 → rate_limited, backoff longo (10min base + jitter ≤15min), custo 0", () => {
    const out = classifyOutcome(resp604, normEmail(), tjspPedido, {
      attachmentId: null,
      retryAttempts: 0,
      maxRetries: 3,
      jobId: "abc",
    });
    expect(out.status).toBe("rate_limited");
    expect(out.costCents).toBe(0);
    const delta = out.nextRetryAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(delta).toBeLessThan(25 * 60_000 + 2000);
  });

  it("attempt 2 NÃO vira failed_permanent (bug antigo: genérico só tinha 2 intervalos)", () => {
    const out = classifyOutcome(resp604, normEmail(), tjspPedido, {
      attachmentId: null,
      retryAttempts: 2,
      maxRetries: 3,
      jobId: "abc",
    });
    expect(out.status).toBe("rate_limited");
    expect(out.nextRetryAt).toBeInstanceOf(Date);
  });

  it("attempt 5 (esgota os 5 intervalos) → failed_permanent rate_limited", () => {
    const out = classifyOutcome(resp604, normEmail(), tjspPedido, {
      attachmentId: null,
      retryAttempts: 5,
      maxRetries: 3,
      jobId: "abc",
    });
    expect(out.status).toBe("failed_permanent");
    expect(out.failureCategory).toBe("rate_limited");
  });

  it("rate_limited NÃO-email continua genérico (~30min) e esgota em attempt 2", () => {
    const normGen: NormalizedResult = {
      ...normEmpty,
      situacao: "nao_emitida",
      failureCategory: "rate_limited",
      detalhes: "Limite de consultas atingido.",
    };
    const respQuota = { code: 668, code_message: "quota", data: [] } as unknown as InfosimplesResponse;
    const a0 = classifyOutcome(respQuota, normGen, tjspPedido, {
      attachmentId: null,
      retryAttempts: 0,
      maxRetries: 3,
      jobId: "abc",
    });
    expect(a0.status).toBe("rate_limited");
    expect(a0.nextRetryAt!.getTime() - Date.now()).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
    const a2 = classifyOutcome(respQuota, normGen, tjspPedido, {
      attachmentId: null,
      retryAttempts: 2,
      maxRetries: 3,
      jobId: "abc",
    });
    expect(a2.status).toBe("failed_permanent");
  });

  it("jitter determinístico: jobIds diferentes → offsets diferentes; sem jobId → base exata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    const mk = (jobId?: string) =>
      classifyOutcome(resp604, normEmail(), tjspPedido, {
        attachmentId: null,
        retryAttempts: 0,
        maxRetries: 3,
        jobId,
      }).nextRetryAt!.getTime();
    const a = mk("job-A");
    const b = mk("job-B");
    expect(a).not.toBe(b); // pedidos diferentes não recolidem no mesmo instante
    expect(mk(undefined)).toBe(Date.now() + 10 * 60_000); // sem jobId = sem jitter
    expect(mk("job-A")).toBe(a); // determinístico (sem Math.random)
    vi.useRealTimers();
  });
});
