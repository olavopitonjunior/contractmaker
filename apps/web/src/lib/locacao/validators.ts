import { z } from "zod";

// Zod schemas para CRUD das entidades operacionais de locação (docs/locacao/spec.md §6.6+).
// Distintos dos schemas do form de contrato (lib/forms/validation-locacao.ts) — estes
// são pra endpoints REST. Defaults conservadores; refines garantem regras de negócio
// (soma de % proprietário = 100, percentual XOR valorFixo no angariador, etc.).

const orgScopeSchema = z.object({
  orgId: z.string().min(1),
});

// ============================================================================
// Property
// ============================================================================

export const PROPERTY_KINDS = [
  "casa",
  "apartamento",
  "apartamento_duplex",
  "apartamento_triplex",
  "cobertura",
  "garden",
  "loft",
  "studio",
  "kitnet",
  "penthouse",
  "flat",
  "sobrado",
  "casa_em_condominio",
  "casa_assobradada",
  "casa_comercial",
  "galpao",
  "sala_comercial",
  "loja",
  "salao",
  "pavilhao",
  "box_garagem",
  "conjunto",
  "andar_corporativo",
  "edicula",
  "bangalo",
  "barracao",
  "chacara",
  "sitio",
  "rancho",
  "fazenda",
  "haras",
  "pousada",
  "hotel",
  "resort",
  "quiosque",
  "ponto",
  "ilha",
  "laje",
  "escritorio",
  "consultorio",
  "predio",
  "terreno",
  "village",
  "outro",
] as const;

export const PROPERTY_STATUSES = [
  "disponivel",
  "anunciado",
  "em_negociacao",
  "locado",
  "manutencao",
  "fora_catalogo",
] as const;

export const propertyCreateSchema = z.object({
  kind: z.enum(PROPERTY_KINDS).default("apartamento"),
  status: z.enum(PROPERTY_STATUSES).default("disponivel"),
  tipoDimob: z.enum(["urbano", "rural"]).default("urbano"),
  rua: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
  matricula: z.string().optional(),
  cartorio: z.string().optional(),
  inscricaoIptu: z.string().optional(),
  area: z.number().positive().optional(),
  atributos: z.any().optional(),
  fotos: z.array(z.string().url()).default([]),
  descricaoIa: z.string().optional(),
  valorAluguelSugerido: z.number().nonnegative().optional(),
});

export const propertyUpdateSchema = propertyCreateSchema.partial();

// ============================================================================
// PropertyOwnership (refine: soma dos % por propriedade = 100)
// ============================================================================

export const OWNERSHIP_TIPOS = [
  "proprietario_principal",
  "proprietario",
  "beneficiario",
] as const;

const ownershipEntrySchema = z.object({
  ownerId: z.string().min(1),
  percentual: z.number().positive().max(100),
  tipo: z.enum(OWNERSHIP_TIPOS).default("proprietario"),
});

export const propertyOwnershipReplaceSchema = z
  .object({
    ownerships: z.array(ownershipEntrySchema).min(1),
  })
  .superRefine((data, ctx) => {
    const sum = data.ownerships.reduce((acc, o) => acc + o.percentual, 0);
    if (Math.abs(sum - 100) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A soma dos percentuais de propriedade deve ser 100. Atual: ${sum.toFixed(2)}.`,
        path: ["ownerships"],
      });
    }
    const principals = data.ownerships.filter((o) => o.tipo === "proprietario_principal").length;
    if (principals > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Apenas um proprietário pode ser principal.",
        path: ["ownerships"],
      });
    }
  });

// ============================================================================
// LeaseTenant (N:N tenant↔lease)
// ============================================================================

export const leaseTenantAddSchema = z.object({
  tenantId: z.string().min(1),
  tipo: z.enum(["titular", "solidario"]).default("solidario"),
});

// ============================================================================
// LeaseAngariador (refine: XOR percentual/valorFixo conforme formaComissao)
// ============================================================================

export const leaseAngariadorCreateSchema = z
  .object({
    partyId: z.string().min(1),
    formaComissao: z.enum(["percentual", "valor_fixo"]).default("percentual"),
    percentual: z.number().positive().max(100).optional(),
    valorFixo: z.number().positive().optional(),
    // null = "por todo o contrato".
    mesesComissao: z.number().int().positive().max(12).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.formaComissao === "percentual" && (data.percentual === undefined || data.percentual === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "formaComissao=percentual exige campo `percentual`.",
        path: ["percentual"],
      });
    }
    if (data.formaComissao === "valor_fixo" && (data.valorFixo === undefined || data.valorFixo === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "formaComissao=valor_fixo exige campo `valorFixo`.",
        path: ["valorFixo"],
      });
    }
  });

// ============================================================================
// Expense (despesa operacional)
// ============================================================================

export const EXPENSE_TYPES = [
  "iptu",
  "condominio",
  "seguro_incendio",
  "seguro_fianca",
  "juros",
  "multa",
  "honorarios",
  "atualizacao_monetaria",
  "custas",
  "moratorios",
  "taxa_locacao",
  "outro",
] as const;

export const expenseCreateSchema = z
  .object({
    leaseContractId: z.string().optional(),
    propertyId: z.string().optional(),
    type: z.enum(EXPENSE_TYPES),
    descricao: z.string().optional(),
    valor: z.number().positive(),
    dueDate: z.coerce.date(),
    parcelaN: z.number().int().positive().default(1),
    parcelaTotal: z.number().int().positive().default(1),
    debitoDe: z.enum(["locatario", "proprietario"]),
    creditoPara: z.enum(["proprietario", "imobiliaria", "fornecedor"]),
    rentChargeId: z.string().optional(),
    fornecedorId: z.string().optional(),
    status: z.enum(["pendente", "pago", "cancelado"]).default("pendente"),
  })
  .superRefine((data, ctx) => {
    if (data.parcelaN > data.parcelaTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parcelaN não pode exceder parcelaTotal.",
        path: ["parcelaN"],
      });
    }
    if (!data.leaseContractId && !data.propertyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Despesa precisa estar ligada a um contrato OU a um imóvel.",
        path: ["leaseContractId"],
      });
    }
    // OCR via Gemini pode lançar `taxa_locacao` como pagamento à vista (1/1).
    if (data.type === "taxa_locacao" && data.parcelaTotal !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Taxa de locação deve ser à vista (parcelaTotal=1).",
        path: ["parcelaTotal"],
      });
    }
  });

export const expenseUpdateSchema = z.object({
  descricao: z.string().optional(),
  valor: z.number().positive().optional(),
  dueDate: z.coerce.date().optional(),
  status: z.enum(["pendente", "pago", "cancelado"]).optional(),
  paidAt: z.coerce.date().optional(),
});

// ============================================================================
// ChecklistTemplate / Checklist
// ============================================================================

const checklistItemSchema = z.object({
  titulo: z.string().min(1),
  obrigatorio: z.boolean().default(true),
  descricao: z.string().optional(),
});

export const checklistTemplateCreateSchema = z.object({
  nome: z.string().min(2),
  itens: z.array(checklistItemSchema).min(1),
  ativo: z.boolean().default(true),
});

const checklistInstanceItemSchema = z.object({
  titulo: z.string().min(1),
  status: z.enum(["pendente", "concluido", "aprovado"]).default("pendente"),
  responsavel: z.string().optional(),
  concluidoAt: z.coerce.date().optional(),
});

export const checklistCreateSchema = z.object({
  leaseContractId: z.string().min(1),
  templateId: z.string().optional(),
  nome: z.string().min(2),
  itens: z.array(checklistInstanceItemSchema).min(1),
});

export const checklistItemTogglePatchSchema = z.object({
  index: z.number().int().nonnegative(),
  status: z.enum(["pendente", "concluido", "aprovado"]),
  responsavel: z.string().optional(),
});

// ============================================================================
// DebtAgreement
// ============================================================================

const debtComponentsSchema = z.object({
  aluguel: z.number().nonnegative().default(0),
  multa: z.number().nonnegative().default(0),
  juros: z.number().nonnegative().default(0),
  honorarios: z.number().nonnegative().default(0),
  custas: z.number().nonnegative().default(0),
  atualizacao: z.number().nonnegative().default(0),
});

export const debtAgreementCreateSchema = z
  .object({
    leaseContractId: z.string().min(1),
    tenantId: z.string().min(1),
    componentes: debtComponentsSchema,
    parcelas: z.number().int().positive().max(36),
    primeiraDataDue: z.coerce.date(),
  })
  .transform((data) => {
    const valorTotal = Object.values(data.componentes).reduce((a, b) => a + b, 0);
    return { ...data, valorTotal };
  })
  .refine((data) => data.valorTotal > 0, {
    message: "Acordo precisa de pelo menos um componente com valor > 0.",
    path: ["componentes"],
  });

// ============================================================================
// InsurancePolicy
// ============================================================================

export const INSURANCE_TIPOS = [
  "seguro_incendio",
  "seguro_fianca",
  "conteudo",
  "rd",
] as const;

export const insurancePolicyCreateSchema = z
  .object({
    leaseContractId: z.string().optional(),
    propertyId: z.string().optional(),
    tipo: z.enum(INSURANCE_TIPOS),
    seguradora: z.string().min(2),
    apoliceNumero: z.string().optional(),
    vigenciaInicio: z.coerce.date(),
    vigenciaFim: z.coerce.date(),
    premioMensal: z.number().nonnegative().optional(),
    responsavelPagamento: z.enum(["imobiliaria", "locatario", "proprietario"]).optional(),
    coberturaJson: z.any().optional(),
    pdfUrl: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.vigenciaFim <= data.vigenciaInicio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "vigenciaFim deve ser posterior a vigenciaInicio.",
        path: ["vigenciaFim"],
      });
    }
    if (!data.leaseContractId && !data.propertyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Apólice precisa estar ligada a um contrato OU a um imóvel.",
        path: ["leaseContractId"],
      });
    }
  });

// ============================================================================
// Maintenance
// ============================================================================

export const MAINTENANCE_TIPOS = [
  "hidraulica",
  "eletrica",
  "pintura",
  "estrutural",
  "eletrodomestico",
  "outro",
] as const;

export const maintenanceCreateSchema = z.object({
  propertyId: z.string().min(1),
  leaseContractId: z.string().optional(),
  tipo: z.enum(MAINTENANCE_TIPOS),
  descricao: z.string().min(5),
  fornecedorId: z.string().optional(),
  custoEstimado: z.number().nonnegative().optional(),
  debitoDe: z.enum(["proprietario", "locatario"]).optional(),
});

export const maintenanceCompleteSchema = z.object({
  custoFinal: z.number().nonnegative(),
  expenseCreatedId: z.string().optional(),
});

// ============================================================================
// RentCharge — endpoint manual (cron usa rent-scheduler diretamente)
// ============================================================================

export const rentChargeListQuerySchema = z.object({
  leaseContractId: z.string().optional(),
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  status: z.string().optional(),
});

// ============================================================================
// Inspection
// ============================================================================

export const INSPECTION_TIPOS = ["entrada", "saida", "contra"] as const;

export const inspectionCreateSchema = z.object({
  propertyId: z.string().min(1),
  leaseContractId: z.string().optional(),
  tipo: z.enum(INSPECTION_TIPOS),
  tipoImovel: z.string().optional(),
  scheduledFor: z.coerce.date().optional(),
  executorId: z.string().optional(),
});

export { orgScopeSchema };
