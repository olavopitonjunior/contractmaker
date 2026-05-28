import { z } from "zod";

// ============================================================================
// Locação — schema Zod (schemaType "locacao_residencial_v1").
// Aditivo: NÃO toca lib/forms/validation.ts (venda). Espelha a estrutura PF/PJ
// de lá, mas com as partes/objetos próprios de locação. Ver docs/locacao/spec.md
// §4.1. As partes (locador/locatário/fiador) reaproveitam o shape de pessoa de
// venda — campos opcionais com defaults pra forms em rascunho ficarem livres.
// ============================================================================

const pessoaFisicaLocacaoSchema = z.object({
  tipo_pessoa: z.literal("fisica"),
  nome: z.string().min(2, "Nome obrigatório"),
  nacionalidade: z.string().optional().default("Brasileiro(a)"),
  estado_civil: z.string().optional().default("Solteiro(a)"),
  profissao: z.string().optional().default(""),
  rg: z.string().optional().default(""),
  cpf: z.string().optional().default(""),
  data_nascimento: z.string().optional().default(""),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  mobile_phone: z.string().optional().default(""),
  endereco: z.string().optional().default(""),
  numero: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  uf: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  // Renda declarada (insumo da análise de crédito Fase 1: renda × aluguel).
  renda_mensal: z.number().optional().default(0),
  // Opt-in pra incluir como signatário ClickSign separado.
  incluir_como_signatario: z.boolean().optional().default(true),
});

const pessoaJuridicaLocacaoSchema = z.object({
  tipo_pessoa: z.literal("juridica"),
  razao_social: z.string().min(2, "Razão social obrigatória"),
  cnpj: z.string().optional().default(""),
  endereco: z.string().optional().default(""),
  numero: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  uf: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  faturamento_mensal: z.number().optional().default(0),
  representante: z
    .object({
      nome: z.string().optional().default(""),
      cpf: z.string().optional().default(""),
      email: z.string().email("Email inválido").optional().or(z.literal("")),
      mobile_phone: z.string().optional().default(""),
    })
    .optional(),
  incluir_como_signatario: z.boolean().optional().default(true),
});

const parteLocacaoSchema = z.discriminatedUnion("tipo_pessoa", [
  pessoaFisicaLocacaoSchema,
  pessoaJuridicaLocacaoSchema,
]);

// Imóvel — referencia opcionalmente uma Property já cadastrada (propertyId).
// Quando ausente, os campos inline permitem criar/editar direto do form.
const imovelLocacaoSchema = z.object({
  propertyId: z.string().optional(),
  kind: z
    .enum([
      "apartamento",
      "casa",
      "comercial_sala",
      "loja",
      "galpao",
      "terreno",
      "temporada",
    ])
    .optional()
    .default("apartamento"),
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
  area: z.number().optional().default(0),
  descricao: z.string().min(10, "Descreva o imóvel com ao menos 10 caracteres"),
});

// Reajuste e vigência.
const aluguelSchema = z.object({
  valor: z.number().min(0).default(0),
  // Encargos embutidos no boleto mensal (IPTU/condomínio quando repassados).
  encargos: z.number().optional().default(0),
  dia_vencimento: z.number().min(1).max(28).optional().default(10),
  indice_reajuste: z.enum(["IGPM", "IPCA", "outro"]).optional().default("IGPM"),
  vigencia_inicio: z.string().optional().default(""),
  vigencia_meses: z.number().optional().default(30),
  taxa_admin_percent: z.number().optional().default(10),
  // Forma de pagamento preferida do aluguel mensal.
  meio_pagamento: z.enum(["pix", "boleto", "qualquer"]).optional().default("pix"),
});

// Garantia locatícia (art. 37 Lei 8.245). Fiador só quando tipo="fiador".
const garantiaSchema = z.object({
  tipo: z
    .enum([
      "fiador",
      "caucao",
      "seguro_fianca",
      "garantia_digital",
      "propria",
      "sem_garantia",
    ])
    .optional()
    .default("caucao"),
  provider: z.string().optional().default(""),
  cobertura_meses: z.number().optional().default(0),
  // Caução: nº de aluguéis depositados (art. 38 §2º — máx 3).
  caucao_meses: z.number().optional().default(0),
  fiador: parteLocacaoSchema.optional(),
});

export const dadosLocacaoSchema = z
  .object({
    locadores: z.array(parteLocacaoSchema).min(1, "Mínimo 1 locador"),
    locatarios: z.array(parteLocacaoSchema).min(1, "Mínimo 1 locatário"),
    imovel: imovelLocacaoSchema,
    aluguel: aluguelSchema,
    garantia: garantiaSchema.optional(),
    // Vistoria de referência (Inspection.id de entrada) — opcional no rascunho.
    vistoria_ref: z.string().optional(),
    foro: z.string().optional().default(""),
    assinatura: z
      .object({
        cidade: z.string().optional().default(""),
        uf: z.string().optional().default(""),
        data: z.string().optional().default(""),
      })
      .optional(),
    // Multa/juros por atraso — Lei 8.245 padrão 2% + 1%/mês.
    config: z
      .object({
        multa_atraso_percent: z.number().default(2),
        juros_mensais_atraso: z.number().default(1),
        multa_rescisoria_meses: z.number().default(3),
      })
      .default({}),
  })
  .superRefine((data, ctx) => {
    // Caução limitada a 3 aluguéis (art. 38 §2º Lei 8.245/91).
    if (data.garantia?.tipo === "caucao") {
      const meses = data.garantia.caucao_meses ?? 0;
      if (meses > 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Caução limitada a 3 aluguéis (art. 38 §2º da Lei 8.245/91).",
          path: ["garantia", "caucao_meses"],
        });
      }
    }
    // Fiança exige dados do fiador.
    if (data.garantia?.tipo === "fiador") {
      const fiador = data.garantia.fiador;
      const nome =
        fiador?.tipo_pessoa === "fisica"
          ? fiador.nome
          : fiador?.tipo_pessoa === "juridica"
            ? fiador.razao_social
            : "";
      if (!nome || nome.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Garantia por fiador exige o nome do fiador.",
          path: ["garantia", "fiador"],
        });
      }
    }
  });

export type DadosLocacaoForm = z.infer<typeof dadosLocacaoSchema>;

export const LOCACAO_SCHEMA_TYPE = "locacao_residencial_v1" as const;

export const LOCACAO_STEP_LABELS = [
  "Locador(es)",
  "Locatário(s)",
  "Imóvel",
  "Aluguel e Reajuste",
  "Garantia",
  "Config e Assinatura",
] as const;
