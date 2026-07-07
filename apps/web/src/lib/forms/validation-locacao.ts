import { z } from "zod";
import {
  collectPartyFormatIssues,
  isValidBirthdate,
} from "@/lib/forms/field-formats";

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
  // Detalhes do prédio/condomínio (cláusula DO IMÓVEL do template v3).
  vagas_garagem: z.number().int().min(0).optional(),
  condominio_nome: z.string().optional().default(""),
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
  // Valores de referência lançados no mesmo boleto pela administradora
  // (cláusula de encargos do template v3) — informativos, não somam no valor.
  iptu_mensal: z.number().min(0).optional(),
  condominio_mensal: z.number().min(0).optional(),
});

// Garantia locatícia (art. 37 Lei 8.245). Fiador só quando tipo="fiador".
const garantiaSchema = z.object({
  tipo: z
    .enum([
      "fiador",
      "caucao",
      "seguro_fianca",
      "garantia_digital",
      "titulo_capitalizacao",
      "propria",
      "sem_garantia",
    ])
    .optional()
    .default("caucao"),
  // Subscritora do título / seguradora / provedora da garantia digital.
  provider: z.string().optional().default(""),
  cobertura_meses: z.number().optional().default(0),
  // Caução: nº de aluguéis depositados (art. 38 §2º — máx 3).
  caucao_meses: z.number().optional().default(0),
  // Título de capitalização caucionado (art. 37, II): valor nominal + proposta.
  titulo_valor: z.number().min(0).optional(),
  titulo_proposta: z.string().optional().default(""),
  fiador: parteLocacaoSchema.optional(),
});

// ============================================================================
// Config fiscal/operacional (A7-A16) — preenchida pelo OPERADOR no diálogo de
// criação do form, não pelo cliente. Espelha os campos que o wizard interno
// (NovoContratoWizard / api/locacao/contracts/wizard) já coleta e que dirigem
// repasse/DIMOB/cobrança — NÃO entram no texto do contrato (template), mas
// alimentam o LeaseContract (ver createLeaseContractFromDataJson).
// ============================================================================
const fiscalSchema = z.object({
  taxa_admin_percent: z.number().min(0).max(100).optional().default(10),
  regime_ir: z
    .enum(["nao_retem", "retem_sem_controle", "retem_imobiliaria", "retem_inquilino"])
    .optional()
    .default("nao_retem"),
  regime_cobranca: z.enum(["mes_vencido", "mes_a_vencer"]).optional().default("mes_a_vencer"),
  isencao_multa_meses: z.number().int().min(0).optional().default(0),
  emitir_nfse: z.boolean().optional().default(false),
  repasse_garantido: z
    .enum(["nao", "alguns_meses", "todo_contrato"])
    .optional()
    .default("nao"),
  repasse_garantido_meses: z.number().int().min(0).optional(),
});

// Angariador (A11) — corretor captador com comissão recorrente sobre o aluguel.
// `meses_comissao` null/0 = todo o contrato.
const angariadorSchema = z.object({
  party_id: z.string().optional(),
  nome: z.string().min(2, "Nome do angariador obrigatório"),
  forma_comissao: z.enum(["percentual", "valor_fixo"]).optional().default("percentual"),
  percentual: z.number().min(0).max(100).optional(),
  valor_fixo: z.number().min(0).optional(),
  meses_comissao: z.number().int().min(0).optional(),
});

// Comissão da imobiliária — taxa de locação cobrada à vista (1º aluguel) +
// angariadores. Base dos boletos de comissão (ver aba Cobrança do deal).
const comissaoSchema = z.object({
  taxa_locacao_percent: z.number().min(0).max(100).optional().default(0),
  angariadores: z.array(angariadorSchema).optional().default([]),
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
    // Multa/juros por atraso — modelo padrão da casa: 10% + 1%/mês (a Lei
    // 8.245/91 não impõe o teto de 2%, que é do CDC/condomínio).
    config: z
      .object({
        multa_atraso_percent: z.number().default(10),
        juros_mensais_atraso: z.number().default(1),
        multa_rescisoria_meses: z.number().default(3),
      })
      .default({}),
    // Operador-only (não renderizadas no template): config fiscal + comissão.
    fiscal: fiscalSchema.optional(),
    comissao: comissaoSchema.optional(),
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

// Passos do wizard PÚBLICO (client-facing) — a config fiscal/comissão é do
// operador (diálogo de criação), não aparece aqui.
export const LOCACAO_STEP_LABELS = [
  "Documentos",
  "Locador(es)",
  "Locatário(s)",
  "Imóvel",
  "Aluguel e Reajuste",
  "Garantia",
  "Confirmação e Assinatura",
] as const;

// ============================================================================
// Locação COMERCIAL (schemaType "locacao_comercial_v1"). Reusa os sub-schemas
// do residencial; diferenças: destinação/ramo de atividade do ponto, finalidade
// comercial por default, cláusula de ação renovatória (art. 51-57 Lei 8.245).
// A caução em dinheiro segue limitada a 3 aluguéis (art. 38 §2º vale p/ ambos).
// ============================================================================
const imovelComercialSchema = imovelLocacaoSchema.extend({
  kind: z
    .enum(["comercial_sala", "loja", "galpao", "terreno", "casa", "apartamento", "temporada"])
    .optional()
    .default("comercial_sala"),
  // Destinação do ponto comercial (ramo de atividade do locatário).
  destinacao: z.string().optional().default(""),
});

export const dadosLocacaoComercialSchema = z
  .object({
    locadores: z.array(parteLocacaoSchema).min(1, "Mínimo 1 locador"),
    locatarios: z.array(parteLocacaoSchema).min(1, "Mínimo 1 locatário"),
    imovel: imovelComercialSchema,
    aluguel: aluguelSchema,
    garantia: garantiaSchema.optional(),
    vistoria_ref: z.string().optional(),
    foro: z.string().optional().default(""),
    assinatura: z
      .object({
        cidade: z.string().optional().default(""),
        uf: z.string().optional().default(""),
        data: z.string().optional().default(""),
      })
      .optional(),
    config: z
      .object({
        multa_atraso_percent: z.number().default(10),
        juros_mensais_atraso: z.number().default(1),
        multa_rescisoria_meses: z.number().default(3),
      })
      .default({}),
    fiscal: fiscalSchema.optional(),
    comissao: comissaoSchema.optional(),
  })
  .superRefine((data, ctx) => {
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

export type DadosLocacaoComercialForm = z.infer<typeof dadosLocacaoComercialSchema>;

export const LOCACAO_COMERCIAL_SCHEMA_TYPE = "locacao_comercial_v1" as const;

export const LOCACAO_COMERCIAL_STEP_LABELS = [
  "Documentos",
  "Locador(es)",
  "Locatário(s)",
  "Imóvel e Destinação",
  "Aluguel e Reajuste",
  "Garantia",
  "Confirmação e Assinatura",
] as const;

// Discriminadores de locação aceitos no fluxo público + helpers de seleção.
export const LOCACAO_SCHEMA_TYPES = [
  LOCACAO_SCHEMA_TYPE,
  LOCACAO_COMERCIAL_SCHEMA_TYPE,
] as const;
export type LocacaoSchemaType = (typeof LOCACAO_SCHEMA_TYPES)[number];

export function isLocacaoSchemaType(v: unknown): v is LocacaoSchemaType {
  return typeof v === "string" && (LOCACAO_SCHEMA_TYPES as readonly string[]).includes(v);
}

export function schemaForLocacaoType(schemaType: string) {
  return schemaType === LOCACAO_COMERCIAL_SCHEMA_TYPE
    ? dadosLocacaoComercialSchema
    : dadosLocacaoSchema;
}

// ============================================================================
// Guarda de FINALIZE (não altera os schemas base, que são .parse()'d por
// import/OCR/testes com dados parciais). Roda SÓ no finalize do form público —
// obrigatoriedade dura (endereço do imóvel, valor, vigência) + formato quando
// preenchido (CPF/CNPJ/CEP/nascimento via field-formats). Não bloqueia a
// geração: os issues são surfaced na resposta pra correção no editor (mesmo
// contrato do schema base). Ver memórias feedback_form_format_rules e
// project_form_hybrid_guard.
// ============================================================================
type FinalizeIssue = { path: string; message: string };

const isBlankStr = (v: unknown): boolean =>
  v === null || v === undefined || String(v).trim() === "";

export function collectLocacaoFinalizeIssues(
  data: Record<string, unknown>
): FinalizeIssue[] {
  const issues: FinalizeIssue[] = [];

  // Endereço do imóvel — obrigatório no finalize (senão o contrato sai
  // "localizado(a) na , nº , /"). Descrição já é obrigatória no schema base.
  const imovel = (data.imovel as Record<string, unknown> | undefined) ?? {};
  for (const [field, label] of [
    ["rua", "Logradouro (rua) do imóvel"],
    ["numero", "Número do imóvel"],
    ["cidade", "Cidade do imóvel"],
    ["uf", "UF do imóvel"],
  ] as const) {
    if (isBlankStr(imovel[field])) {
      issues.push({ path: `imovel.${field}`, message: `${label} é obrigatório.` });
    }
  }

  // Valor do aluguel > 0.
  const aluguel = (data.aluguel as Record<string, unknown> | undefined) ?? {};
  if (!(Number(aluguel.valor) > 0)) {
    issues.push({
      path: "aluguel.valor",
      message: "Informe o valor do aluguel (maior que zero).",
    });
  }

  // Início da vigência — obrigatório e, quando preenchido, data válida.
  if (isBlankStr(aluguel.vigencia_inicio)) {
    issues.push({
      path: "aluguel.vigencia_inicio",
      message: "Informe a data de início da vigência.",
    });
  } else if (!isValidBirthdate(String(aluguel.vigencia_inicio), new Date(9999, 0, 1))) {
    // Reusa o parser de data (ISO/BR, calendário válido); teto no ano 9999
    // pra não rejeitar vigência futura (isValidBirthdate proíbe futuro).
    issues.push({
      path: "aluguel.vigencia_inicio",
      message: "Data de início da vigência inválida (use AAAA-MM-DD).",
    });
  }

  // Formato das partes (CPF/CNPJ/CEP/telefone) quando preenchido.
  const parties: Array<[string, unknown]> = [];
  (data.locadores as unknown[] | undefined)?.forEach((p, i) =>
    parties.push([`locadores.${i}`, p])
  );
  (data.locatarios as unknown[] | undefined)?.forEach((p, i) =>
    parties.push([`locatarios.${i}`, p])
  );
  for (const [prefix, parte] of parties) {
    for (const issue of collectPartyFormatIssues(parte as Record<string, unknown>)) {
      issues.push({ path: `${prefix}.${issue.path}`, message: issue.message });
    }
  }

  // Fiador completo quando garantia = fiador (CPF + endereço, além do nome que
  // o schema base já exige).
  const garantia = data.garantia as
    | { tipo?: string; fiador?: Record<string, unknown> }
    | undefined;
  if (garantia?.tipo === "fiador") {
    const fiador = garantia.fiador ?? {};
    const isPJ = fiador.tipo_pessoa === "juridica";
    if (!isPJ) {
      if (isBlankStr(fiador.cpf)) {
        issues.push({ path: "garantia.fiador.cpf", message: "CPF do fiador é obrigatório." });
      }
      if (isBlankStr(fiador.endereco)) {
        issues.push({
          path: "garantia.fiador.endereco",
          message: "Endereço do fiador é obrigatório.",
        });
      }
    } else if (isBlankStr(fiador.cnpj)) {
      issues.push({ path: "garantia.fiador.cnpj", message: "CNPJ do fiador é obrigatório." });
    }
    for (const issue of collectPartyFormatIssues(fiador)) {
      issues.push({ path: `garantia.fiador.${issue.path}`, message: issue.message });
    }
  }

  return issues;
}

export function stepLabelsForLocacaoType(schemaType: string) {
  return schemaType === LOCACAO_COMERCIAL_SCHEMA_TYPE
    ? LOCACAO_COMERCIAL_STEP_LABELS
    : LOCACAO_STEP_LABELS;
}
