import { describe, it, expect } from "vitest";
import {
  dadosLocacaoSchema,
  dadosLocacaoComercialSchema,
  collectLocacaoFinalizeIssues,
  sumEncargosMensais,
  seedOutrosEncargos,
  comissaoLocacaoSchema,
  angariadorLocacaoSchema,
} from "../validation-locacao";

const baseValid = {
  locadores: [{ tipo_pessoa: "fisica", nome: "João Locador" }],
  locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária" }],
  imovel: { descricao: "Apartamento de 2 quartos no Centro" },
  aluguel: { valor: 2500 },
};

describe("dadosLocacaoSchema", () => {
  it("aceita locação residencial mínima válida e aplica defaults", () => {
    const parsed = dadosLocacaoSchema.parse(baseValid);
    expect(parsed.aluguel.dia_vencimento).toBe(10);
    expect(parsed.aluguel.indice_reajuste).toBe("IGPM");
    expect(parsed.aluguel.taxa_admin_percent).toBe(10);
    expect(parsed.config?.multa_atraso_percent).toBe(10);
    expect(parsed.config?.juros_mensais_atraso).toBe(1);
  });

  it("aceita garantia por título de capitalização com valor e proposta", () => {
    const res = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: {
        tipo: "titulo_capitalizacao",
        provider: "Porto Seguro Capitalização S.A.",
        titulo_valor: 15000,
        titulo_proposta: "1234567-001",
      },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.garantia?.tipo).toBe("titulo_capitalizacao");
      expect(res.data.garantia?.titulo_valor).toBe(15000);
      expect(res.data.garantia?.titulo_proposta).toBe("1234567-001");
    }
  });

  it("exige ao menos 1 locador e 1 locatário", () => {
    expect(
      dadosLocacaoSchema.safeParse({ ...baseValid, locadores: [] }).success
    ).toBe(false);
    expect(
      dadosLocacaoSchema.safeParse({ ...baseValid, locatarios: [] }).success
    ).toBe(false);
  });

  it("rejeita caução acima de 3 aluguéis (art. 38 §2º)", () => {
    const res = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: { tipo: "caucao", caucao_meses: 4 },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("caucao_meses"))).toBe(true);
    }
  });

  it("aceita caução de até 3 aluguéis", () => {
    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        garantia: { tipo: "caucao", caucao_meses: 3 },
      }).success
    ).toBe(true);
  });

  it("exige nome do fiador quando garantia é fiador", () => {
    const semFiador = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: { tipo: "fiador" },
    });
    expect(semFiador.success).toBe(false);

    const comFiador = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: {
        tipo: "fiador",
        fiador: { tipo_pessoa: "fisica", nome: "Carlos Fiador" },
      },
    });
    expect(comFiador.success).toBe(true);
  });

  it("garantia onerosa: aceita o legado `garantia_digital` na ENTRADA e grava o novo", () => {
    // Rascunho salvo antes do rename de 2026-08-25. Sem o preprocess ele seria
    // rejeitado pelo enum e o formulário inteiro ficaria inválido.
    const legado = dadosLocacaoSchema.parse({
      ...baseValid,
      garantia: { tipo: "garantia_digital", provider: "CredAluga" },
    });
    expect(legado.garantia?.tipo).toBe("garantia_onerosa");
    expect(legado.garantia?.provider).toBe("CredAluga");

    const novo = dadosLocacaoSchema.parse({
      ...baseValid,
      garantia: { tipo: "garantia_onerosa", provider: "Loft" },
    });
    expect(novo.garantia?.tipo).toBe("garantia_onerosa");

    // O legado é a ÚNICA exceção; slug de fornecedor não vira modalidade.
    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        garantia: { tipo: "almada" },
      }).success
    ).toBe(false);
  });

  it("seguro-fiança: tomador e vigência são opcionais e restritos ao enum", () => {
    // Ausentes — o operador/imobiliária escolhe, nada é forçado.
    const semEscolha = dadosLocacaoSchema.parse({
      ...baseValid,
      garantia: { tipo: "seguro_fianca", provider: "Porto Seguro" },
    });
    expect(semEscolha.garantia?.seguro_tomador).toBeUndefined();
    expect(semEscolha.garantia?.seguro_vigencia).toBeUndefined();

    const comEscolha = dadosLocacaoSchema.parse({
      ...baseValid,
      garantia: {
        tipo: "seguro_fianca",
        seguro_tomador: "proprietario",
        seguro_vigencia: "prazo_contrato",
      },
    });
    expect(comEscolha.garantia?.seguro_tomador).toBe("proprietario");
    expect(comEscolha.garantia?.seguro_vigencia).toBe("prazo_contrato");

    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        garantia: { tipo: "seguro_fianca", seguro_tomador: "imobiliaria" },
      }).success
    ).toBe(false);
    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        garantia: { tipo: "garantia_onerosa", seguro_vigencia: "mensal" },
      }).success
    ).toBe(false);
  });

  // A descrição era obrigatória (>= 10 caracteres) e travava a etapa do imóvel.
  // A corretora pediu que saísse do caminho crítico: virava discussão de
  // negociação num formulário que só precisa identificar o imóvel. O endereço
  // segue obrigatório; quem quiser exigir a descrição liga pelo preset da org.
  it("aceita imóvel sem descrição", () => {
    const parsed = dadosLocacaoSchema.safeParse({
      ...baseValid,
      imovel: { ...baseValid.imovel, descricao: undefined },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.imovel.descricao).toBe("");
  });

  it("aceita descrição curta — o mínimo de 10 caracteres saiu", () => {
    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        imovel: { ...baseValid.imovel, descricao: "curto" },
      }).success
    ).toBe(true);
  });
});

describe("collectLocacaoFinalizeIssues", () => {
  const finalizeValid = {
    locadores: [{ tipo_pessoa: "fisica", nome: "João Locador", cpf: "39053344705" }],
    locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária" }],
    imovel: {
      descricao: "Apartamento de 2 quartos no Centro",
      rua: "Rua das Flores",
      numero: "100",
      cidade: "São Paulo",
      uf: "SP",
    },
    aluguel: { valor: 2500, vigencia_inicio: "2026-06-01" },
  };

  const paths = (data: Record<string, unknown>) =>
    collectLocacaoFinalizeIssues(data).map((i) => i.path);

  it("não acusa problemas quando tudo preenchido", () => {
    expect(collectLocacaoFinalizeIssues(finalizeValid)).toEqual([]);
  });

  it("exige endereço do imóvel (rua/numero/cidade/uf)", () => {
    const p = paths({ ...finalizeValid, imovel: { descricao: "Apto no Centro térreo" } });
    expect(p).toEqual(
      expect.arrayContaining(["imovel.rua", "imovel.numero", "imovel.cidade", "imovel.uf"])
    );
  });

  it("exige valor de aluguel > 0", () => {
    expect(paths({ ...finalizeValid, aluguel: { valor: 0, vigencia_inicio: "2026-06-01" } })).toContain(
      "aluguel.valor"
    );
  });

  it("exige início de vigência", () => {
    expect(paths({ ...finalizeValid, aluguel: { valor: 2500 } })).toContain(
      "aluguel.vigencia_inicio"
    );
  });

  it("valida formato de CPF quando preenchido", () => {
    const p = paths({
      ...finalizeValid,
      locadores: [{ tipo_pessoa: "fisica", nome: "João Locador", cpf: "11111111111" }],
    });
    expect(p).toContain("locadores.0.cpf");
  });

  it("exige nome e CPF do cônjuge quando a parte PF é casada (outorga uxória)", () => {
    const p = paths({
      ...finalizeValid,
      locadores: [
        {
          tipo_pessoa: "fisica",
          nome: "João Locador",
          cpf: "39053344705",
          estado_civil: "Casado(a)",
        },
      ],
    });
    expect(p).toEqual(
      expect.arrayContaining(["locadores.0.conjuge.nome", "locadores.0.conjuge.cpf"])
    );
  });

  it("aceita união estável com cônjuge completo e não exige e-mail dele", () => {
    expect(
      collectLocacaoFinalizeIssues({
        ...finalizeValid,
        locadores: [
          {
            tipo_pessoa: "fisica",
            nome: "João Locador",
            cpf: "39053344705",
            estado_civil: "União Estável",
            // Sem e-mail de propósito: e-mail do cônjuge é recomendação no
            // wizard, nunca bloqueio de finalize.
            conjuge: { nome: "Ana Companheira", cpf: "11144477735" },
          },
        ],
      })
    ).toEqual([]);
  });

  it("não exige cônjuge de parte solteira nem de PJ", () => {
    const p = paths({
      ...finalizeValid,
      locadores: [
        {
          tipo_pessoa: "juridica",
          razao_social: "Imob Ltda",
          cnpj: "11222333000181",
          estado_civil: "Casado(a)",
        },
      ],
      locatarios: [
        { tipo_pessoa: "fisica", nome: "Maria Locatária", estado_civil: "Solteiro(a)" },
      ],
    });
    expect(p.filter((path) => path.includes("conjuge"))).toEqual([]);
  });

  it("exige cônjuge do fiador casado (art. 1.647, III CC)", () => {
    const p = paths({
      ...finalizeValid,
      garantia: {
        tipo: "fiador",
        fiador: {
          tipo_pessoa: "fisica",
          nome: "Carlos Fiador",
          cpf: "39053344705",
          endereco: "Rua X, 10",
          estado_civil: "Casado(a)",
        },
      },
    });
    expect(p).toEqual(
      expect.arrayContaining([
        "garantia.fiador.conjuge.nome",
        "garantia.fiador.conjuge.cpf",
      ])
    );
  });

  it("exige CPF e endereço do fiador quando garantia é fiador", () => {
    const p = paths({
      ...finalizeValid,
      garantia: {
        tipo: "fiador",
        fiador: { tipo_pessoa: "fisica", nome: "Carlos Fiador" },
      },
    });
    expect(p).toEqual(
      expect.arrayContaining(["garantia.fiador.cpf", "garantia.fiador.endereco"])
    );
  });
});

describe("encargos mensais detalhados", () => {
  it("aplica default 0 em outros_encargos (campo aditivo)", () => {
    const parsed = dadosLocacaoSchema.parse(baseValid);
    expect(parsed.aluguel.outros_encargos).toBe(0);
    // Comercial reusa o mesmo aluguelSchema.
    expect(dadosLocacaoComercialSchema.parse(baseValid).aluguel.outros_encargos).toBe(0);
  });

  it("aceita outros_encargos informado e rejeita negativo", () => {
    const ok = dadosLocacaoSchema.safeParse({
      ...baseValid,
      aluguel: { valor: 2500, outros_encargos: 75.5 },
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.aluguel.outros_encargos).toBe(75.5);

    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        aluguel: { valor: 2500, outros_encargos: -1 },
      }).success
    ).toBe(false);
  });

  it("não quebra form legado que só tinha `encargos` manual", () => {
    const parsed = dadosLocacaoSchema.parse({
      ...baseValid,
      aluguel: { valor: 2500, encargos: 500 },
    });
    expect(parsed.aluguel.encargos).toBe(500);
    expect(parsed.aluguel.outros_encargos).toBe(0);
  });

  it("soma condomínio + IPTU + outros", () => {
    expect(
      sumEncargosMensais({
        condominio_mensal: 450,
        iptu_mensal: 120.5,
        outros_encargos: 30.25,
      })
    ).toBe(600.75);
  });

  it("ignora ausentes, nulos, negativos e não-numéricos", () => {
    expect(sumEncargosMensais(null)).toBe(0);
    expect(sumEncargosMensais(undefined)).toBe(0);
    expect(sumEncargosMensais({})).toBe(0);
    expect(
      sumEncargosMensais({
        condominio_mensal: 100,
        iptu_mensal: null,
        outros_encargos: "abc",
      })
    ).toBe(100);
    // Negativo não abate o total (o MoneyInput também trava em min 0).
    expect(sumEncargosMensais({ condominio_mensal: 100, iptu_mensal: -50 })).toBe(100);
  });

  it("arredonda a 2 casas (sem lixo de float)", () => {
    expect(sumEncargosMensais({ condominio_mensal: 0.1, iptu_mensal: 0.2 })).toBe(0.3);
  });

  it("aceita strings vindas de um dataJson cru", () => {
    expect(
      sumEncargosMensais({ condominio_mensal: "450", outros_encargos: "50" })
    ).toBe(500);
  });
});

describe("seedOutrosEncargos (migração suave do form legado)", () => {
  it("joga o total legado em outros quando não há itens", () => {
    expect(seedOutrosEncargos({ encargos: 500 })).toBe(500);
  });

  it("semeia só a diferença quando já há itens detalhados (caso OCR)", () => {
    expect(
      seedOutrosEncargos({ encargos: 500, iptu_mensal: 120, condominio_mensal: 300 })
    ).toBe(80);
  });

  it("é idempotente — reabrir o form já migrado não semeia de novo", () => {
    const primeiro = seedOutrosEncargos({ encargos: 500 });
    expect(primeiro).toBe(500);
    expect(seedOutrosEncargos({ encargos: 500, outros_encargos: primeiro })).toBeNull();
  });

  it("não semeia quando não há total legado ou os itens já o cobrem", () => {
    expect(seedOutrosEncargos(null)).toBeNull();
    expect(seedOutrosEncargos({})).toBeNull();
    expect(seedOutrosEncargos({ encargos: 0 })).toBeNull();
    expect(seedOutrosEncargos({ encargos: 100, condominio_mensal: 100 })).toBeNull();
    // Itens maiores que o legado: a soma manda, nada a migrar.
    expect(seedOutrosEncargos({ encargos: 100, condominio_mensal: 300 })).toBeNull();
  });
});

describe("formato das sub-partes do fiador no finalize", () => {
  const base = {
    locadores: [{ tipo_pessoa: "fisica", nome: "João Locador" }],
    locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária" }],
    imovel: {
      descricao: "Apartamento de 2 quartos no Centro",
      rua: "Rua das Flores",
      numero: "100",
      cidade: "São Paulo",
      uf: "SP",
    },
    aluguel: { valor: 2500, vigencia_inicio: "2026-06-01" },
  };
  const paths = (data: Record<string, unknown>) =>
    collectLocacaoFinalizeIssues(data).map((i) => i.path);

  it("valida CPF/telefone do cônjuge do fiador", () => {
    const p = paths({
      ...base,
      garantia: {
        tipo: "fiador",
        fiador: {
          tipo_pessoa: "fisica",
          nome: "Carlos Fiador",
          cpf: "39053344705",
          endereco: "Rua X, 10",
          conjuge: { nome: "Ana Fiadora", cpf: "11111111111", mobile_phone: "119" },
        },
      },
    });
    expect(p).toEqual(
      expect.arrayContaining([
        "garantia.fiador.conjuge.cpf",
        "garantia.fiador.conjuge.mobile_phone",
      ])
    );
  });

  it("valida CPF do representante do fiador PJ", () => {
    const p = paths({
      ...base,
      garantia: {
        tipo: "fiador",
        fiador: {
          tipo_pessoa: "juridica",
          razao_social: "Fiadora Ltda",
          cnpj: "11222333000181",
          representante: { nome: "Ana Representante", cpf: "11111111111" },
        },
      },
    });
    expect(p).toContain("garantia.fiador.representante.cpf");
  });
});

// ============================================================================
// Comissão de locação — corretagem (one-shot) + angariadores (recorrente).
// Superfície do OPERADOR: não entra no wizard público (ver ROLE_PATHS).
// ============================================================================
describe("comissaoLocacaoSchema", () => {
  it("aceita corretagem sem angariadores e aplica defaults", () => {
    const parsed = comissaoLocacaoSchema.parse({ taxa_locacao_percent: 100 });
    expect(parsed.taxa_locacao_percent).toBe(100);
    expect(parsed.angariadores).toEqual([]);
  });

  it("preenche taxa 0 quando omitida (comissão opcional)", () => {
    expect(comissaoLocacaoSchema.parse({}).taxa_locacao_percent).toBe(0);
  });

  it("rejeita taxa fora de 0..100", () => {
    expect(comissaoLocacaoSchema.safeParse({ taxa_locacao_percent: 101 }).success).toBe(
      false
    );
    expect(comissaoLocacaoSchema.safeParse({ taxa_locacao_percent: -1 }).success).toBe(
      false
    );
  });

  it("aceita angariador com qualificação completa (aditivo 2026-07)", () => {
    const parsed = comissaoLocacaoSchema.parse({
      taxa_locacao_percent: 50,
      angariadores: [
        {
          nome: "Carla Angariadora",
          tipo_pessoa: "fisica",
          cpf: "111.444.777-35",
          creci: "199.905",
          email: "carla@imob.com",
          mobile_phone: "(11) 99999-0000",
          forma_comissao: "percentual",
          percentual: 10,
          meses_comissao: 12,
          splitRecipientId: "sr-1",
        },
      ],
    });
    expect(parsed.angariadores[0]).toMatchObject({
      cpf: "111.444.777-35",
      creci: "199.905",
      splitRecipientId: "sr-1",
    });
  });

  it("angariador legado (só nome + percentual) segue válido com defaults", () => {
    const parsed = angariadorLocacaoSchema.parse({ nome: "Carla", percentual: 10 });
    expect(parsed.tipo_pessoa).toBe("fisica");
    expect(parsed.forma_comissao).toBe("percentual");
    expect(parsed.cpf).toBe("");
  });

  it("aceita angariador PJ com valor fixo", () => {
    const parsed = angariadorLocacaoSchema.parse({
      nome: "Imobiliária Parceira",
      tipo_pessoa: "juridica",
      cnpj: "11.222.333/0001-81",
      forma_comissao: "valor_fixo",
      valor_fixo: 150,
    });
    expect(parsed.forma_comissao).toBe("valor_fixo");
    expect(parsed.valor_fixo).toBe(150);
  });

  it("rejeita angariador sem nome utilizável", () => {
    expect(angariadorLocacaoSchema.safeParse({ nome: "C" }).success).toBe(false);
    expect(angariadorLocacaoSchema.safeParse({}).success).toBe(false);
  });

  it("rejeita e-mail inválido do angariador mas aceita string vazia", () => {
    expect(
      angariadorLocacaoSchema.safeParse({ nome: "Carla", email: "nao-email" }).success
    ).toBe(false);
    expect(
      angariadorLocacaoSchema.safeParse({ nome: "Carla", email: "" }).success
    ).toBe(true);
  });

  it("dadosLocacaoSchema carrega a comissão inteira (residencial e comercial)", () => {
    const comissao = {
      taxa_locacao_percent: 100,
      angariadores: [{ nome: "Carla", cpf: "111.444.777-35", percentual: 10 }],
    };
    const res = dadosLocacaoSchema.parse({ ...baseValid, comissao });
    expect(res.comissao?.angariadores[0].cpf).toBe("111.444.777-35");
    const com = dadosLocacaoComercialSchema.parse({
      ...baseValid,
      imovel: { ...baseValid.imovel, destinacao: "Padaria" },
      comissao,
    });
    expect(com.comissao?.taxa_locacao_percent).toBe(100);
  });
});
