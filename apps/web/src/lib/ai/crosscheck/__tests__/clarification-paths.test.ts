import { describe, it, expect } from "vitest";
import { crossCheckCertidoes, type CertidaoJobLite } from "../certidoes";

const today = new Date("2026-05-17T12:00:00Z");

function dataJson(): Record<string, unknown> {
  return {
    vendedores: [{ nome: "João da Silva", cpf: "529.982.247-25" }],
    compradores: [{ nome: "Maria Oliveira", cpf: "453.178.287-91" }],
    imoveis: [{ rua: "Rua das Flores", numero: "100", cidade: "São Paulo", uf: "SP" }],
  };
}

function jobMatriculaLimpa(): CertidaoJobLite {
  return {
    id: "j-mat",
    endpoint: "registradores/matric-obter",
    label: "Matrícula",
    targetKind: "imovel",
    targetIndex: 0,
    status: "success",
    resultCode: 200,
    resultData: {
      situacao: "negativa",
      emissao: "12/05/2026",
      raw: { tem_onus: false, ha_penhora: false, ha_alienacao_fiduciaria: false },
    },
    errorMessage: null,
    finishedAt: today,
    attachmentId: null,
  };
}

describe("clarification_paths — findings ambíguos", () => {
  it("cível positiva NÃO tem suggested_aditamento mas tem clarification_paths", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        jobMatriculaLimpa(),
        {
          id: "j-civel",
          endpoint: "tribunal/tjsp/obter-civel",
          label: "TJSP Cível",
          targetKind: "vendedor",
          targetIndex: 0,
          status: "success",
          resultCode: 200,
          resultData: { situacao: "positiva", detalhes: "Ação em curso" },
          errorMessage: null,
          finishedAt: today,
          attachmentId: null,
        },
      ],
      now: today,
    });
    const civel = r.findings.find((f) => f.kind === "vendedor_civel_positiva");
    expect(civel).toBeDefined();
    expect(civel?.suggested_aditamento).toBeUndefined();
    expect(civel?.clarification_paths).toBeDefined();
    expect(civel!.clarification_paths!.length).toBeGreaterThanOrEqual(3);
    // Confirma que os caminhos sugerem ação investigativa
    expect(civel!.clarification_paths!.some((p) => p.match(/processo|cópia/i))).toBe(true);
  });

  it("antecedentes positiva também usa clarification_paths", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        jobMatriculaLimpa(),
        {
          id: "j-antec",
          endpoint: "antecedentes-criminais-pf/emit",
          label: "Antecedentes PF",
          targetKind: "vendedor",
          targetIndex: 0,
          status: "success",
          resultCode: 200,
          resultData: { situacao: "positiva", detalhes: "Registros" },
          errorMessage: null,
          finishedAt: today,
          attachmentId: null,
        },
      ],
      now: today,
    });
    const antec = r.findings.find((f) => f.kind === "vendedor_antecedentes_positiva");
    expect(antec).toBeDefined();
    expect(antec?.suggested_aditamento).toBeUndefined();
    expect(antec?.clarification_paths).toBeDefined();
    expect(antec!.clarification_paths!.some((p) => p.match(/perdimento|condenação/i))).toBe(true);
  });

  it("matrícula com ônus AINDA tem suggested_aditamento (caminho determinístico)", () => {
    // Confirma que findings actionable mantêm suggested_aditamento
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        {
          id: "j-mat-onus",
          endpoint: "registradores/matric-obter",
          label: "Matrícula",
          targetKind: "imovel",
          targetIndex: 0,
          status: "success",
          resultCode: 200,
          resultData: {
            situacao: "positiva",
            emissao: "12/05/2026",
            raw: { tem_onus: true, ha_penhora: true, ha_alienacao_fiduciaria: false },
          },
          errorMessage: null,
          finishedAt: today,
          attachmentId: null,
        },
      ],
      now: today,
    });
    const mat = r.findings.find((f) => f.kind === "matricula_onus");
    expect(mat).toBeDefined();
    expect(mat?.suggested_aditamento).toBeDefined();
    expect(mat?.suggested_aditamento).toMatch(/CC art\. 418/i);
    expect(mat?.clarification_paths).toBeUndefined();
  });

  it("findings com suggested_aditamento E clarification_paths não coexistem (consistência)", () => {
    const r = crossCheckCertidoes({
      contractDataJson: dataJson(),
      jobs: [
        jobMatriculaLimpa(),
        {
          id: "j-x",
          endpoint: "receita-federal/pgfn",
          label: "PGFN",
          targetKind: "vendedor",
          targetIndex: 0,
          status: "success",
          resultCode: 200,
          resultData: { situacao: "positiva", detalhes: "Débito R$ 5000" },
          errorMessage: null,
          finishedAt: today,
          attachmentId: null,
        },
      ],
      now: today,
    });
    for (const f of r.findings) {
      // Cada finding usa UM dos dois (não ambos), exceto cível/antecedentes
      // que são puramente ambíguos.
      if (f.suggested_aditamento) {
        expect(f.clarification_paths).toBeUndefined();
      }
    }
  });
});
