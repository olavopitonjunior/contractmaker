import { describe, it, expect } from "vitest";
import {
  parsePartyPath,
  isValueEmpty,
  getByPath,
  effectiveRequiredPaths,
  findMissingRequired,
  findCertidaoRecommendations,
} from "../party-required";

// Helper: getValue sobre um objeto de valores do form.
const reader = (values: Record<string, unknown>) => (p: string) =>
  getByPath(values, p);

describe("effectiveRequiredPaths — expansão por parte (todas, não só índice 0)", () => {
  it("expande vendedores.0.X para todos os índices existentes, com remap PJ", () => {
    const get = reader({
      vendedores: [{ tipo_pessoa: "fisica" }, { tipo_pessoa: "juridica" }],
    });
    const r = effectiveRequiredPaths(
      ["vendedores", "vendedores.0.cpf", "vendedores.0.email"],
      get,
    );
    expect(r).toContain("vendedores.0.cpf"); // PF índice 0
    expect(r).toContain("vendedores.0.email");
    expect(r).toContain("vendedores.1.cnpj"); // PJ índice 1: cpf→cnpj
    expect(r).toContain("vendedores.1.email"); // e-mail vale p/ a PJ também
    expect(r).not.toContain("vendedores.1.cpf"); // identidade remapeada
  });

  it("uma só parte → comportamento idêntico ao anterior (só índice 0)", () => {
    const get = reader({ vendedores: [{ tipo_pessoa: "fisica" }] });
    expect(effectiveRequiredPaths(["vendedores.0.email"], get)).toEqual([
      "vendedores.0.email",
    ]);
  });

  it("lista ausente → mantém a garantia do índice 0", () => {
    expect(
      effectiveRequiredPaths(["vendedores.0.email"], () => undefined),
    ).toEqual(["vendedores.0.email"]);
  });
});

describe("findCertidaoRecommendations (guarda híbrida, não-bloqueante)", () => {
  it("PF com campos de certidão vazios → recomenda rg/nascimento/nome_mae/sexo", () => {
    const get = reader({
      vendedores: [{ tipo_pessoa: "fisica", nome: "Maria", cpf: "111" }],
    });
    const recs = findCertidaoRecommendations("vendedores", 1, get);
    expect(recs.map((r) => r.field).sort()).toEqual([
      "data_nascimento",
      "nome_mae",
      "rg",
      "sexo",
    ]);
  });

  it("PF com tudo preenchido → sem recomendações", () => {
    const get = reader({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          rg: "123",
          data_nascimento: "1980-01-01",
          nome_mae: "Joana",
          sexo: "F",
        },
      ],
    });
    expect(findCertidaoRecommendations("vendedores", 1, get)).toEqual([]);
  });

  it("PJ é ignorada (campos PF-only não se aplicam)", () => {
    const get = reader({
      compradores: [{ tipo_pessoa: "juridica", razao_social: "ACME" }],
    });
    expect(findCertidaoRecommendations("compradores", 1, get)).toEqual([]);
  });

  it("múltiplas partes: agrupa por índice só as PF com faltas", () => {
    const get = reader({
      vendedores: [
        { tipo_pessoa: "fisica", rg: "1", data_nascimento: "1980-01-01", nome_mae: "J", sexo: "M" },
        { tipo_pessoa: "fisica", rg: "", data_nascimento: "", nome_mae: "", sexo: "" },
      ],
    });
    const recs = findCertidaoRecommendations("vendedores", 2, get);
    expect(recs.every((r) => r.idx === 1)).toBe(true);
    expect(recs).toHaveLength(4);
  });
});

describe("parsePartyPath", () => {
  it("quebra path de campo de parte", () => {
    expect(parsePartyPath("vendedores.0.cpf")).toEqual({
      list: "vendedores",
      idx: 0,
      field: "cpf",
    });
    expect(parsePartyPath("compradores.2.estado_civil")).toEqual({
      list: "compradores",
      idx: 2,
      field: "estado_civil",
    });
  });

  it("retorna null pro path guarda-chuva e seções não-parte", () => {
    expect(parsePartyPath("vendedores")).toBeNull();
    expect(parsePartyPath("imoveis.0.rua")).toBeNull();
    expect(parsePartyPath("pagamento.valor_total")).toBeNull();
  });

  it("preserva campo aninhado como string", () => {
    expect(parsePartyPath("vendedores.0.conjuge.nome")?.field).toBe(
      "conjuge.nome",
    );
  });
});

describe("isValueEmpty", () => {
  it("vazio: undefined/null/string vazia/array vazio", () => {
    expect(isValueEmpty(undefined)).toBe(true);
    expect(isValueEmpty(null)).toBe(true);
    expect(isValueEmpty("")).toBe(true);
    expect(isValueEmpty([])).toBe(true);
  });

  it("preenchido: string, número (inclui 0), objeto, array não-vazio", () => {
    expect(isValueEmpty("x")).toBe(false);
    expect(isValueEmpty(0)).toBe(false); // 0 não é vazio (parity com wizard)
    expect(isValueEmpty({})).toBe(false);
    expect(isValueEmpty([1])).toBe(false);
  });
});

describe("effectiveRequiredPaths — Pessoa Física (sem remap)", () => {
  const values = {
    vendedores: [{ tipo_pessoa: "fisica", cpf: "", estado_civil: "" }],
  };
  it("mantém os paths PF intactos", () => {
    const out = effectiveRequiredPaths(
      ["vendedores", "vendedores.0.cpf", "vendedores.0.estado_civil"],
      reader(values),
    );
    expect(out).toEqual([
      "vendedores",
      "vendedores.0.cpf",
      "vendedores.0.estado_civil",
    ]);
  });
});

describe("effectiveRequiredPaths — Pessoa Jurídica (remap/drop)", () => {
  const values = {
    vendedores: [
      { tipo_pessoa: "juridica", cnpj: "36000043000114", razao_social: "ACME" },
    ],
  };

  it("cpf vira cnpj", () => {
    const out = effectiveRequiredPaths(["vendedores.0.cpf"], reader(values));
    expect(out).toEqual(["vendedores.0.cnpj"]);
  });

  it("estado_civil e rg (PF-only) são dispensados", () => {
    const out = effectiveRequiredPaths(
      ["vendedores.0.estado_civil", "vendedores.0.rg"],
      reader(values),
    );
    expect(out).toEqual([]);
  });

  it("endereço/cidade/uf valem nos dois — mantidos", () => {
    const out = effectiveRequiredPaths(
      ["vendedores.0.endereco", "vendedores.0.cidade", "vendedores.0.uf"],
      reader(values),
    );
    expect(out).toEqual([
      "vendedores.0.endereco",
      "vendedores.0.cidade",
      "vendedores.0.uf",
    ]);
  });

  it("path guarda-chuva `vendedores` passa intacto", () => {
    const out = effectiveRequiredPaths(["vendedores"], reader(values));
    expect(out).toEqual(["vendedores"]);
  });

  it("conjunto realista (preset padrao+custom) num PJ → só cnpj + endereço", () => {
    const out = effectiveRequiredPaths(
      [
        "vendedores",
        "vendedores.0.cpf",
        "vendedores.0.estado_civil",
        "vendedores.0.endereco",
        "vendedores.0.cidade",
        "vendedores.0.uf",
        "vendedores.0.rg",
      ],
      reader(values),
    );
    expect(out).toEqual([
      "vendedores",
      "vendedores.0.cnpj",
      "vendedores.0.endereco",
      "vendedores.0.cidade",
      "vendedores.0.uf",
    ]);
  });

  it("dedup: cpf→cnpj não duplica um cnpj já listado", () => {
    const out = effectiveRequiredPaths(
      ["vendedores.0.cnpj", "vendedores.0.cpf"],
      reader(values),
    );
    expect(out).toEqual(["vendedores.0.cnpj"]);
  });
});

describe("findMissingRequired — cenário do bug (PJ vendedor completo)", () => {
  // Reproduz o form real: vendedor PJ com razão social/cnpj/endereço
  // preenchidos. Sob preset padrao+custom RG, NÃO deve sobrar pendência.
  const values = {
    vendedores: [
      {
        tipo_pessoa: "juridica",
        razao_social: "R. O. E Silva Incorporadora Eireli",
        cnpj: "36000043000114",
        endereco: "Av. Mato Grosso",
        cidade: "Caraguatatuba",
        uf: "SP",
      },
    ],
  };
  const required = [
    "vendedores",
    "vendedores.0.cpf",
    "vendedores.0.estado_civil",
    "vendedores.0.endereco",
    "vendedores.0.cidade",
    "vendedores.0.uf",
    "vendedores.0.rg",
  ];

  it("não acusa nenhuma pendência fantasma", () => {
    expect(findMissingRequired(required, reader(values))).toEqual([]);
  });

  it("acusa cnpj faltando quando PJ sem cnpj", () => {
    const semCnpj = {
      vendedores: [{ tipo_pessoa: "juridica", endereco: "x", cidade: "y", uf: "SP" }],
    };
    expect(findMissingRequired(required, reader(semCnpj))).toEqual([
      "vendedores.0.cnpj",
    ]);
  });
});

describe("findMissingRequired — Pessoa Física", () => {
  it("aponta cpf/estado_civil vazios de PF", () => {
    const values = {
      vendedores: [
        { tipo_pessoa: "fisica", cpf: "", estado_civil: "", endereco: "Rua A", cidade: "SP", uf: "SP" },
      ],
    };
    const required = [
      "vendedores",
      "vendedores.0.cpf",
      "vendedores.0.estado_civil",
      "vendedores.0.endereco",
      "vendedores.0.cidade",
      "vendedores.0.uf",
    ];
    expect(findMissingRequired(required, reader(values))).toEqual([
      "vendedores.0.cpf",
      "vendedores.0.estado_civil",
    ]);
  });
});
