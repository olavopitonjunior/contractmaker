import { describe, it, expect } from "vitest";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";

const findSection = (secs: ReturnType<typeof buildConsolidatedFormSummary>, title: string) =>
  secs.find((s) => s.title.startsWith(title));

describe("buildConsolidatedFormSummary", () => {
  it("returns [] for non compra_venda schemas", () => {
    expect(buildConsolidatedFormSummary({ locador: [] }, { schemaType: "locacao_residencial_v1" })).toEqual([]);
  });

  it("returns [] for null/empty data", () => {
    expect(buildConsolidatedFormSummary(null)).toEqual([]);
    expect(buildConsolidatedFormSummary({})).toEqual([]);
  });

  it("builds party sections with formatted CPF/CNPJ and endereco", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "João Silva",
          cpf: "11122233344",
          rg: "12.345.678-9",
          estado_civil: "Casado(a)",
          email: "joao@ex.com",
          endereco: "Rua A",
          numero: "100",
          cidade: "São Paulo",
          uf: "SP",
          cep: "01234567",
          conjuge: { nome: "Maria Silva", cpf: "55566677788" },
        },
      ],
      compradores: [
        { tipo_pessoa: "juridica", razao_social: "Imob LTDA", cnpj: "11222333000144" },
      ],
    });

    const vend = findSection(secs, "Vendedor");
    expect(vend).toBeDefined();
    expect(vend!.rows).toContainEqual({ label: "CPF", value: "111.222.333-44" });
    expect(vend!.rows).toContainEqual({ label: "Cônjuge", value: "Maria Silva · CPF 555.666.777-88" });
    expect(vend!.rows.find((r) => r.label === "Endereço")!.value).toContain("Rua A, 100");
    expect(vend!.rows.find((r) => r.label === "Endereço")!.value).toContain("01234-567");

    const comp = findSection(secs, "Comprador");
    expect(comp!.rows).toContainEqual({ label: "Razão social", value: "Imob LTDA" });
    expect(comp!.rows).toContainEqual({ label: "CNPJ", value: "11.222.333/0001-44" });
  });

  it("builds imovel and parcelas sections", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [{ tipo_pessoa: "fisica", nome: "X" }],
      imoveis: [{ rua: "Av B", numero: "50", cidade: "Rio", uf: "RJ", matricula: "9999", descricao: "Apartamento 2 quartos" }],
      pagamento: { valor_total: 500000, parcelas: [{ valor: 50000, tipo_texto: "Sinal", momento: "assinatura" }] },
    });
    const imv = findSection(secs, "Imóvel");
    expect(imv!.rows).toContainEqual({ label: "Matrícula", value: "9999" });
    const parc = findSection(secs, "Parcelas");
    expect(parc).toBeDefined();
    expect(parc!.rows[0].label).toBe("Parcela 1");
    expect(parc!.rows[0].value).toContain("R$ 50.000,00");
  });

  it("lists attachments when provided", () => {
    const secs = buildConsolidatedFormSummary(
      { vendedores: [{ tipo_pessoa: "fisica", nome: "X" }] },
      { attachments: [{ filename: "rg.pdf", category: "rg" }] }
    );
    const docs = findSection(secs, "Documentos anexados");
    expect(docs!.rows).toContainEqual({ label: "RG", value: "rg.pdf" });
  });

  // --- Fidelidade: o resumo é o que a imobiliária recebe por e-mail. Campo
  // preenchido no form e ausente aqui = informação perdida silenciosamente.
  // Foi exatamente a queixa que originou estes casos.

  it("traz os dados pessoais completos da parte, não só nome/CPF/RG", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "João Silva",
          cpf: "11122233344",
          nacionalidade: "Brasileiro",
          profissao: "Empresário",
          nome_mae: "Ana Silva",
          mobile_phone: "(11) 97779-0079",
          naturalidade: "São Paulo/SP",
        },
      ],
    });
    const vend = findSection(secs, "Vendedor")!;
    expect(vend.rows).toContainEqual({ label: "Profissão", value: "Empresário" });
    expect(vend.rows).toContainEqual({ label: "Nacionalidade", value: "Brasileiro" });
    expect(vend.rows).toContainEqual({ label: "Nome da mãe", value: "Ana Silva" });
    expect(vend.rows).toContainEqual({ label: "Telefone", value: "(11) 97779-0079" });
    expect(vend.rows).toContainEqual({ label: "Naturalidade", value: "São Paulo/SP" });
  });

  it("traz os dados de recebimento (PIX e conta) do vendedor", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "João",
          cpf: "11122233344",
          recebimento: {
            pix_chave: "11122233344",
            pix_tipo_chave: "CPF",
            banco: "Itaú",
            agencia: "4100",
            conta: "04314-2",
            tipo_conta: "corrente",
          },
        },
      ],
    });
    const rec = findSection(secs, "Vendedor")!.rows.find((r) => r.label === "Recebimento")!;
    expect(rec.value).toContain("PIX (CPF) 11122233344");
    expect(rec.value).toContain("Itaú");
    expect(rec.value).toContain("Ag. 4100");
    expect(rec.value).toContain("Conta 04314-2");
  });

  it("cônjuge sai com os dados completos, não só nome + CPF", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "João",
          cpf: "11122233344",
          conjuge: {
            nome: "Maria",
            cpf: "55566677788",
            rg: "182026279",
            email: "maria@ex.com",
            data_nascimento: "1971-01-03",
          },
        },
      ],
    });
    const conj = findSection(secs, "Vendedor")!.rows.find((r) => r.label === "Cônjuge")!;
    expect(conj.value).toContain("RG 182026279");
    expect(conj.value).toContain("maria@ex.com");
    expect(conj.value).toContain("nasc. 03/01/1971");
  });

  it("ignora parte sem identidade (linha em branco com estado_civil default)", () => {
    // `withPartyDefaults` injeta estado_civil em TODA linha PF, inclusive nas
    // vazias, e o auto-save persiste — antes isso virava um "Vendedor 2"
    // fantasma contendo só "Estado civil: Solteiro(a)".
    const secs = buildConsolidatedFormSummary({
      vendedores: [
        { tipo_pessoa: "fisica", nome: "João", cpf: "11122233344" },
        { tipo_pessoa: "fisica", estado_civil: "Solteiro(a)" },
      ],
    });
    expect(secs.filter((s) => s.title.startsWith("Vendedor"))).toHaveLength(1);
  });

  it("lista comissionados individualmente com papel, documento e fatia", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [{ tipo_pessoa: "fisica", nome: "X", cpf: "11122233344" }],
      comissao: {
        comissionados: [
          { nome: "Corretor A", cpf: "11122233344", papel_texto: "Captador", percentual: 50 },
          { nome: "Imob B", cnpj: "11222333000144", papel: "imobiliaria_principal", valor: 15000, creci: "24.342-J" },
        ],
      },
    });
    const com = findSection(secs, "Comissionados")!;
    expect(com.rows).toHaveLength(2);
    expect(com.rows[0].label).toBe("Captador");
    expect(com.rows[0].value).toContain("50%");
    expect(com.rows[1].value).toContain("11.222.333/0001-44");
    expect(com.rows[1].value).toContain("CRECI 24.342-J");
    expect(com.rows[1].value).toContain("R$ 15.000,00");
  });

  it("traz a etapa de posse/propriedade (step 6)", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [{ tipo_pessoa: "fisica", nome: "X", cpf: "11122233344" }],
      status_propriedade: "quitado-registrado",
      ocupacao: "desocupado",
      entrega_posse: { momento_texto: "na data da assinatura" },
      titulo_definitivo: { opcao: "certidoes-apos", prazo_dias: 60 },
    });
    const posse = findSection(secs, "Posse e propriedade")!;
    expect(posse.rows).toContainEqual({ label: "Ocupação do imóvel", value: "desocupado" });
    expect(posse.rows).toContainEqual({ label: "Entrega da posse", value: "na data da assinatura" });
    expect(posse.rows.find((r) => r.label === "Título definitivo")!.value).toContain("60 dias");
  });

  it("traz testemunhas, desistência, foro e local/data de assinatura", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [{ tipo_pessoa: "fisica", nome: "X", cpf: "11122233344" }],
      testemunhas: [{ nome: "Testemunha Um", cpf: "11122233344", email: "t1@ex.com" }],
      desistencia: { permite: true, prazo_dias: 7 },
      foro: "arbitragem",
      assinatura: { cidade: "São Paulo", uf: "SP", data: "2026-06-09" },
      config: { multa_penal_moratoria: 2, base_calculo_multa: "valor da parcela", multa_cominatoria_diaria: 150 },
    });
    const test = findSection(secs, "Testemunhas")!;
    expect(test.rows[0].value).toContain("Testemunha Um");

    const cfg = findSection(secs, "Configuração contratual")!;
    expect(cfg.rows).toContainEqual({ label: "Cláusula de desistência", value: "Permitida — prazo de 7 dia(s)" });
    expect(cfg.rows).toContainEqual({ label: "Foro", value: "arbitragem" });
    expect(cfg.rows).toContainEqual({ label: "Local de assinatura", value: "São Paulo/SP" });
    expect(cfg.rows).toContainEqual({ label: "Data de assinatura", value: "09/06/2026" });
    expect(cfg.rows).toContainEqual({ label: "Base de cálculo da multa", value: "valor da parcela" });
    expect(cfg.rows).toContainEqual({ label: "Multa cominatória diária", value: "R$ 150,00" });
  });

  it("traz observações gerais", () => {
    const secs = buildConsolidatedFormSummary({
      vendedores: [{ tipo_pessoa: "fisica", nome: "X", cpf: "11122233344" }],
      observacoes: "Vendedor pediu para agendar a escritura pela manhã.",
    });
    const obs = findSection(secs, "Observações gerais")!;
    expect(obs.rows[0].value).toContain("escritura pela manhã");
  });
});
