import { z } from "zod";

// ========= Shared schemas =========

const pessoaFisicaSchema = z.object({
  tipo_pessoa: z.literal("fisica"),
  nome: z.string().min(2, "Nome obrigatorio"),
  nacionalidade: z.string().optional().default("Brasileiro(a)"),
  estado_civil: z.string().optional().default("Solteiro(a)"),
  profissao: z.string().optional().default(""),
  rg: z.string().optional().default(""),
  cpf: z.string().optional().default(""),
  data_nascimento: z.string().optional().default(""),
  // H.3 (Phase H, 2026-04-18) — exigido pelo TJSP pedido-cível (code 606 sem)
  nome_mae: z.string().optional().default(""),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  endereco: z.string().optional().default(""),
  numero: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  uf: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  tem_procurador: z.boolean().optional().default(false),
  conjuge: z.object({
    nome: z.string().optional().default(""),
    cpf: z.string().optional().default(""),
    rg: z.string().optional().default(""),
    nacionalidade: z.string().optional().default(""),
    profissao: z.string().optional().default(""),
    // Espelha campos pessoais do titular — exigidos por TJSP/PGFN/Antecedentes PF
    data_nascimento: z.string().optional().default(""),
    nome_mae: z.string().optional().default(""),
    naturalidade: z.string().optional().default(""),
    email: z.string().email("Email invalido").optional().or(z.literal("")),
    // Endereço próprio do cônjuge — só usado quando endereco_igual_ao_titular === false
    endereco: z.string().optional().default(""),
    numero: z.string().optional().default(""),
    complemento: z.string().optional().default(""),
    bairro: z.string().optional().default(""),
    cidade: z.string().optional().default(""),
    uf: z.string().optional().default(""),
    cep: z.string().optional().default(""),
    // Flag default true: helper getEnderecoEfetivo lê endereço do titular
    endereco_igual_ao_titular: z.boolean().optional().default(true),
    // Opt-in pra incluir o cônjuge como signatário ClickSign separado.
    // Marcado pelo popup de envio (ou no form quando email já existir).
    incluir_como_signatario: z.boolean().optional().default(false),
  }).optional(),
  procurador: z.object({
    nome: z.string().optional().default(""),
    cpf: z.string().optional().default(""),
    rg: z.string().optional().default(""),
    endereco: z.string().optional().default(""),
    numero: z.string().optional().default(""),
    cidade: z.string().optional().default(""),
    uf: z.string().optional().default(""),
  }).optional(),
});

const pessoaJuridicaSchema = z.object({
  tipo_pessoa: z.literal("juridica"),
  razao_social: z.string().min(2, "Razao social obrigatoria"),
  cnpj: z.string().optional().default(""),
  endereco: z.string().optional().default(""),
  numero: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  uf: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  representante: z.object({
    nome: z.string().optional().default(""),
    cpf: z.string().optional().default(""),
    nacionalidade: z.string().optional().default(""),
    estado_civil: z.string().optional().default(""),
    profissao: z.string().optional().default(""),
    // Espelha titular PF — exigido por PGFN PF e Antecedentes PF do
    // representante quando há diligência sobre os signatários da PJ.
    rg: z.string().optional().default(""),
    data_nascimento: z.string().optional().default(""),
    nome_mae: z.string().optional().default(""),
    naturalidade: z.string().optional().default(""),
    email: z.string().email("Email invalido").optional().or(z.literal("")),
  }).optional(),
});

const parteSchema = z.discriminatedUnion("tipo_pessoa", [
  pessoaFisicaSchema,
  pessoaJuridicaSchema,
]);

// ========= Step schemas =========

export const step1Schema = z.object({
  vendedores: z.array(parteSchema).min(1, "Minimo 1 vendedor"),
});

export const step2Schema = z.object({
  compradores: z.array(parteSchema).min(1, "Minimo 1 comprador"),
});

export const step3Schema = z.object({
  imoveis: z.array(z.object({
    rua: z.string().optional().default(""),
    numero: z.string().optional().default(""),
    complemento: z.string().optional().default(""),
    bairro: z.string().optional().default(""),
    cidade: z.string().optional().default(""),
    uf: z.string().optional().default(""),
    cep: z.string().optional().default(""),
    matricula: z.string().optional().default(""),
    cartorio: z.string().optional().default(""),
    inscricao_iptu: z.string().optional().default(""),
    sql: z.string().optional().default(""),
    inscricao_municipal: z.string().optional().default(""),
    descricao: z.string().min(10, "Descreva o imóvel com ao menos 10 caracteres"),
  })).min(1, "Minimo 1 imovel"),
});

export const step4Schema = z.object({
  status_propriedade: z.string().optional().default("quitado-registrado"),
  saldo_devedor: z.number().optional().default(0),
  tem_debitos: z.boolean().optional().default(false),
  debitos: z.object({
    iptu: z.object({ selecionado: z.boolean().default(false), valor: z.number().default(0) }).optional(),
    condominio: z.object({ selecionado: z.boolean().default(false), valor: z.number().default(0) }).optional(),
    outros: z.string().optional().default(""),
  }).optional(),
  vicios: z.object({
    opcao: z.string().optional().default("renuncia"),
    descricao_reparar: z.string().optional().default(""),
    descricao_desocultados: z.string().optional().default(""),
  }).optional(),
  debitos_assumidos: z.object({
    assume: z.boolean().optional().default(false),
    descricao: z.string().optional().default(""),
  }).optional(),
  regularizacoes: z.object({
    tem: z.boolean().optional().default(false),
    prazo_dias: z.number().optional().default(30),
    descricao: z.string().optional().default(""),
  }).optional(),
});

export const step5Schema = z.object({
  modalidade: z.enum(["a_vista", "financiamento"]).default("a_vista"),
  pagamento: z.object({
    valor_total: z.number().min(0).default(0),
    sinal_arras: z.number().default(0),
    recursos_proprios: z.number().default(0),
    fgts: z.number().default(0),
    cessao_consorcio: z.number().default(0),
    alienacao_fiduciaria: z.number().default(0),
    outras_formas: z.number().default(0),
    meio_pagamento: z.string().optional().default("transferencia bancaria"),
    parcelas: z.array(z.object({
      tipo_texto: z.string().default(""),
      dias: z.number().default(0),
      valor: z.number().default(0),
    })).optional().default([]),
  }),
  incluso_no_preco: z.string().optional().default(""),
});

export const step6Schema = z.object({
  ocupacao: z.string().optional().default("desocupado"),
  locacao: z.object({
    data_preferencia: z.string().optional().default(""),
    situacao: z.string().optional().default(""),
  }).optional(),
  entrega_posse: z.object({
    momento: z.string().optional().default("assinatura"),
    momento_texto: z.string().optional().default("assinatura do contrato"),
  }).optional(),
  titulo_definitivo: z.object({
    prazo_dias: z.number().optional().default(60),
    opcao: z.string().optional().default("certidoes-apos"),
  }).optional(),
});

export const step7Schema = z.object({
  comissao: z.object({
    valor: z.number().default(0),
    quem_paga: z.string().optional().default("comprador"),
    quem_paga_texto: z.string().optional().default("Parte Compradora"),
    quando_paga: z.string().optional().default("assinatura"),
    quando_paga_texto: z.string().optional().default("no ato da assinatura"),
    // H.16 (Phase H, 2026-04-18) — suporta corretor PF ou imobiliária PJ
    corretora_tipo_pessoa: z
      .enum(["fisica", "juridica"])
      .optional()
      .default("juridica"),
    imobiliaria_nome: z.string().optional().default(""),
    imobiliaria_cnpj: z.string().optional().default(""),
    imobiliaria_email: z.string().email("Email invalido").optional().or(z.literal("")),
    creci: z.string().optional().default(""),
    percentual: z.number().optional(),
    incluir_como_signatario: z.boolean().optional().default(false),
    // Fonte canônica produzida pelo extractor Gemini (CCV import). Permite
    // múltiplos comissionados (corretora + intermediária + sub-corretor).
    // Declarado opcional pra não exigir preenchimento no form Handlebars,
    // mas o Zod precisa conhecê-lo pra não strippar em saves do form.
    comissionados: z.array(z.object({
      nome: z.string().optional().default(""),
      cpf: z.string().optional().default(""),
      cnpj: z.string().optional().default(""),
      tipo_pessoa: z.enum(["fisica", "juridica"]).optional(),
      creci: z.string().optional().default(""),
      email: z.string().email("Email invalido").optional().or(z.literal("")),
      percentual: z.number().optional(),
      valor: z.number().optional(),
      incluir_como_signatario: z.boolean().optional().default(false),
    })).optional(),
  }).optional(),
  desistencia: z.object({
    permite: z.boolean().optional().default(false),
    prazo_dias: z.number().optional().default(7),
  }).optional(),
  foro: z.string().optional().default("arbitragem"),
  assinatura: z.object({
    cidade: z.string().optional().default(""),
    uf: z.string().optional().default(""),
    data: z.string().optional().default(""),
  }).optional(),
  testemunhas: z.array(z.object({
    nome: z.string().default(""),
    cpf: z.string().default(""),
    email: z.string().email("Email invalido").optional().or(z.literal("")),
    incluir_como_signatario: z.boolean().optional().default(false),
  })).optional().default([
    { nome: "", cpf: "", email: "" },
    { nome: "", cpf: "", email: "" },
  ]),
  config: z.object({
    multa_penal_moratoria: z.number().default(2),
    base_calculo_multa: z.string().default("valor da parcela"),
    juros_mensais_atraso: z.number().default(1),
    atualizacao_monetaria: z.string().default("IPCA"),
    prazo_atraso_rescisao: z.number().default(10),
    multa_cominatoria_diaria: z.number().default(150),
    multa_penal_compensatoria: z.number().default(10),
    prazo_multa_rescisoria: z.number().default(7),
  }).optional(),
});

// Full form schema — the superRefine enforces that when a physical-person party
// is married ("Casado(a)" or "União Estável"), both nome and cpf of the conjuge
// are mandatory. This mirrors the server-side validator in lib/ai/validators.ts
// so the error surfaces during the form flow (on submit) instead of only at
// contract approval time, where the user would have lost context.
const requiresConjuge = (estadoCivil?: string) =>
  estadoCivil === "Casado(a)" || estadoCivil === "União Estável";

export const dadosContratoSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .merge(step4Schema)
  .merge(step5Schema)
  .merge(step6Schema)
  .merge(step7Schema)
  .superRefine((data, ctx) => {
    const checkParte = (
      list: "vendedores" | "compradores",
      idx: number,
      parte: z.infer<typeof parteSchema>
    ) => {
      if (parte.tipo_pessoa !== "fisica") return;
      if (!requiresConjuge(parte.estado_civil)) return;
      const nome = parte.conjuge?.nome?.trim() ?? "";
      const cpf = parte.conjuge?.cpf?.trim() ?? "";
      if (nome.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Nome do cônjuge obrigatório quando casado(a)",
          path: [list, idx, "conjuge", "nome"],
        });
      }
      if (cpf.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CPF do cônjuge obrigatório quando casado(a)",
          path: [list, idx, "conjuge", "cpf"],
        });
      }
    };
    data.vendedores.forEach((p, i) => checkParte("vendedores", i, p));
    data.compradores.forEach((p, i) => checkParte("compradores", i, p));
  });

export type DadosContratoForm = z.infer<typeof dadosContratoSchema>;

export const STEP_LABELS = [
  "Documentos",
  "Vendedor(es)",
  "Comprador(es)",
  "Imóvel(is)",
  "Status e Débitos",
  "Pagamento",
  "Posse e Título",
  "Comissão e Config",
] as const;

// Campos obrigatorios por etapa (usado por form.trigger para validacao)
export const STEP_REQUIRED_FIELDS: ReadonlyArray<ReadonlyArray<string>> = [
  [],
  ["vendedores"],
  ["compradores"],
  ["imoveis.0.rua", "imoveis.0.cidade", "imoveis.0.uf", "imoveis.0.descricao"],
  [],
  ["pagamento.valor_total"],
  [],
  [],
] as const;
