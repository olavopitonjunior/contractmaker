import { describe, it, expect } from "vitest";
import {
  crossCheckCertidoes,
  type CertidaoJobLite,
} from "../certidoes";

const today = new Date("2026-05-16T12:00:00Z");
const ageDaysAgo = (days: number): string => {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

function dataJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vendedores: [
      { nome: "João da Silva", cpf: "529.982.247-25", estado_civil: "Solteiro(a)" },
    ],
    compradores: [{ nome: "Maria Oliveira", cpf: "453.178.287-91" }],
    imoveis: [{ rua: "Rua das Flores", numero: "100", cidade: "São Paulo", uf: "SP" }],
    pagamento: { valor_total: 500_000 },
    ...overrides,
  };
}

function job(overrides: Partial<CertidaoJobLite> = {}): CertidaoJobLite {
  return {
    id: "job-" + Math.random().toString(36).slice(2, 8),
    endpoint: "registradores/matric-obter",
    label: "Certidão de Matrícula",
    targetKind: "imovel",
    targetIndex: 0,
    status: "success",
    resultCode: 200,
    resultData: null,
    errorMessage: null,
    finishedAt: today,
    attachmentId: null,
    ...overrides,
  };
}

describe("crossCheckCertidoes — matrícula", () => {
  it("finding `matricula_faltando` quando deal não tem job ONR de matrícula success", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [], // nenhuma certidão
      now: today,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe("matricula_faltando");
    expect(r.findings[0].severity).toBe("error");
    expect(r.summary.hasBlockingIssues).toBe(true);
  });

  it("finding `matricula_onus` quando tem_onus=true", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          resultData: {
            situacao: "positiva",
            emissao: ageDaysAgo(5),
            detalhes: "Matrícula 12345 · 1º RI SP",
            raw: { tem_onus: true, ha_penhora: false, ha_alienacao_fiduciaria: false },
          },
        }),
      ],
      now: today,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe("matricula_onus");
    expect(r.findings[0].severity).toBe("error");
    expect(r.findings[0].suggested_aditamento).toContain("ônus reais");
    expect(r.findings[0].suggested_aditamento).toContain("CC art. 418");
  });

  it("finding `matricula_onus` quando ha_penhora=true OU ha_alienacao_fiduciaria=true", () => {
    const r1 = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          resultData: {
            situacao: "positiva",
            emissao: ageDaysAgo(5),
            raw: { tem_onus: false, ha_penhora: true, ha_alienacao_fiduciaria: false },
          },
        }),
      ],
      now: today,
    });
    expect(r1.findings[0].kind).toBe("matricula_onus");
    expect(r1.findings[0].message).toMatch(/penhora/);

    const r2 = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          resultData: {
            situacao: "positiva",
            emissao: ageDaysAgo(5),
            raw: { ha_alienacao_fiduciaria: true },
          },
        }),
      ],
      now: today,
    });
    expect(r2.findings[0].kind).toBe("matricula_onus");
    expect(r2.findings[0].message).toMatch(/alienação fiduciária/);
  });

  it("finding `matricula_vencida` quando emissão > 30 dias e sem ônus", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          resultData: {
            situacao: "negativa",
            emissao: ageDaysAgo(45),
            raw: { tem_onus: false, ha_penhora: false, ha_alienacao_fiduciaria: false },
          },
        }),
      ],
      now: today,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe("matricula_vencida");
    expect(r.findings[0].severity).toBe("warning");
    expect(r.findings[0].manual_action?.label).toMatch(/atualizada/i);
  });

  it("sem findings quando matrícula limpa e fresca", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          resultData: {
            situacao: "negativa",
            emissao: ageDaysAgo(5),
            raw: { tem_onus: false, ha_penhora: false, ha_alienacao_fiduciaria: false, ha_indisponibilidade: false },
          },
        }),
      ],
      now: today,
    });
    expect(r.findings).toHaveLength(0);
    expect(r.summary.hasBlockingIssues).toBe(false);
  });
});

describe("crossCheckCertidoes — partes", () => {
  it("PGFN positiva → severity error + aditamento de quitação fiscal", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          endpoint: "receita-federal/pgfn",
          label: "CND Federal + Dívida Ativa",
          targetKind: "vendedor",
          targetIndex: 0,
          resultData: { situacao: "positiva", detalhes: "Dívida ativa R$ 15.000" },
        }),
        // matrícula limpa pra isolar o finding fiscal
        job({
          resultData: {
            situacao: "negativa",
            emissao: ageDaysAgo(5),
            raw: { tem_onus: false, ha_penhora: false, ha_alienacao_fiduciaria: false },
          },
        }),
      ],
      now: today,
    });
    const fiscal = r.findings.find((f) => f.kind === "vendedor_fiscal_positiva");
    expect(fiscal).toBeDefined();
    expect(fiscal?.severity).toBe("error");
    expect(fiscal?.suggested_aditamento).toContain("débitos fiscais");
    expect(fiscal?.target).toMatch(/Vendedor 1/);
  });

  it("CNDT (trabalhista) positiva → severity warning", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          endpoint: "tribunal/tst/cndt",
          label: "CNDT",
          targetKind: "vendedor",
          targetIndex: 0,
          resultData: { situacao: "positiva", detalhes: "Ação trabalhista em curso" },
        }),
        job({
          resultData: {
            situacao: "negativa",
            emissao: ageDaysAgo(5),
            raw: { tem_onus: false, ha_penhora: false, ha_alienacao_fiduciaria: false },
          },
        }),
      ],
      now: today,
    });
    const trab = r.findings.find((f) => f.kind === "vendedor_trabalhista_positiva");
    expect(trab).toBeDefined();
    expect(trab?.severity).toBe("warning");
    expect(trab?.suggested_aditamento).toContain("trabalhista");
  });

  it("IPTU positiva → error com aditamento de quitação municipal", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          endpoint: "pref/sp/sao-paulo/iptu",
          label: "IPTU SP",
          targetKind: "imovel",
          targetIndex: 0,
          resultData: { situacao: "positiva", detalhes: "Débito R$ 3.500" },
        }),
        job({
          resultData: {
            situacao: "negativa",
            emissao: ageDaysAgo(5),
            raw: { tem_onus: false, ha_penhora: false, ha_alienacao_fiduciaria: false },
          },
        }),
      ],
      now: today,
    });
    const iptu = r.findings.find((f) => f.kind === "imovel_iptu_pendente");
    expect(iptu).toBeDefined();
    expect(iptu?.severity).toBe("error");
    expect(iptu?.suggested_aditamento).toContain("débitos municipais");
  });
});

describe("crossCheckCertidoes — falha permanente com portal manual", () => {
  it("retorna manual_action com portalUrl quando job falha", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        job({
          endpoint: "receita-federal/pgfn",
          label: "CND Federal",
          targetKind: "vendedor",
          targetIndex: 0,
          status: "failed",
          errorMessage: "Portal indisponível após 3 retries",
          resultData: null,
        }),
        job({
          resultData: {
            situacao: "negativa",
            emissao: ageDaysAgo(5),
            raw: { tem_onus: false, ha_penhora: false, ha_alienacao_fiduciaria: false },
          },
        }),
      ],
      now: today,
    });
    const fail = r.findings.find((f) => f.kind === "certidao_falhou_portal_manual");
    expect(fail).toBeDefined();
    expect(fail?.severity).toBe("info");
    expect(fail?.manual_action?.url).toContain("receita");
  });
});

describe("crossCheckCertidoes — summary aggregation", () => {
  it("conta findings por severity e kind", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        // 1 erro: matrícula com ônus
        job({
          resultData: {
            situacao: "positiva",
            emissao: ageDaysAgo(5),
            raw: { tem_onus: true },
          },
        }),
        // 1 erro: PGFN
        job({
          endpoint: "receita-federal/pgfn",
          label: "CND",
          targetKind: "vendedor",
          targetIndex: 0,
          resultData: { situacao: "positiva", detalhes: "" },
        }),
        // 1 warning: trabalhista
        job({
          endpoint: "tribunal/tst/cndt",
          label: "CNDT",
          targetKind: "vendedor",
          targetIndex: 0,
          resultData: { situacao: "positiva", detalhes: "" },
        }),
      ],
      now: today,
    });
    expect(r.summary.total).toBe(3);
    expect(r.summary.bySeverity.error).toBe(2);
    expect(r.summary.bySeverity.warning).toBe(1);
    expect(r.summary.hasBlockingIssues).toBe(true);
  });
});
