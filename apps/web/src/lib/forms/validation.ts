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
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  endereco: z.string().optional().default(""),
  numero: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
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
  cidade: z.string().optional().default(""),
  uf: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  representante: z.object({
    nome: z.string().optional().default(""),
    cpf: z.string().optional().default(""),
    nacionalidade: z.string().optional().default(""),
    estado_civil: z.string().optional().default(""),
    profissao: z.string().optional().default(""),
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
    descricao: z.string().optional().default(""),
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
    imobiliaria_nome: z.string().optional().default(""),
    imobiliaria_cnpj: z.string().optional().default(""),
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
  })).optional().default([{ nome: "", cpf: "" }, { nome: "", cpf: "" }]),
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

// Full form schema
export const dadosContratoSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .merge(step4Schema)
  .merge(step5Schema)
  .merge(step6Schema)
  .merge(step7Schema);

export type DadosContratoForm = z.infer<typeof dadosContratoSchema>;

export const STEP_LABELS = [
  "Vendedor(es)",
  "Comprador(es)",
  "Imovel(is)",
  "Status e Debitos",
  "Pagamento",
  "Posse e Titulo",
  "Comissao e Config",
] as const;
