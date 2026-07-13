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
// Garantia — labels PT-BR (Guarantee.tipo é String livre no Prisma; união do
// enum do form público com os tipos extras do wizard ADM)
// ============================================================================

export const GARANTIA_TIPO_LABELS: Record<string, string> = {
  caucionante: "Caucionante",
  caucao: "Caução",
  cessao_fiduciaria: "Cessão fiduciária",
  fiador: "Fiador",
  seguro_fianca: "Seguro-fiança",
  garantia_digital: "Garantia locatícia (digital)",
  titulo_capitalizacao: "Título de capitalização",
  propria: "Garantia própria",
  sem_garantia: "Não possui garantia",
};

// Lifecycle novo (pendente→em_analise→aprovada→vigente→executada/finalizada) em
// união com os status legados de rows antigas (ativa|acionada|encerrada|recusada).
// UI mapeia legado→label novo (ativa→Vigente); sem backfill.
export const GUARANTEE_STATUSES = [
  "pendente",
  "em_analise",
  "aprovada",
  "vigente",
  "executada",
  "finalizada",
  // legados
  "ativa",
  "acionada",
  "encerrada",
  "recusada",
] as const;

export const GUARANTEE_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  aprovada: "Aprovada",
  vigente: "Vigente",
  executada: "Executada",
  finalizada: "Finalizada",
  ativa: "Vigente",
  acionada: "Executada",
  encerrada: "Finalizada",
  recusada: "Recusada",
};

const guaranteeBaseFields = {
  leaseContractId: z.string().min(1),
  status: z.enum(GUARANTEE_STATUSES).default("pendente"),
  coberturaMeses: z.number().int().positive().max(60).optional(),
  externalRef: z.string().optional(),
  observacoes: z.string().max(2000).optional(),
  // true quando o contrato já tem garantia: snapshot da atual em historicoJson + sobrescreve.
  substituir: z.boolean().default(false),
};

const fiadorPartySchema = z.object({
  nome: z.string().min(2),
  cpf: z.string().optional(),
  rg: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  endereco: z.string().optional(),
  profissao: z.string().optional(),
  rendaMensal: z.number().nonnegative().optional(),
});

// União discriminada por tipo — cada modalidade tem o payload mínimo do benchmark.
export const guaranteeCreateSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("fiador"),
    fiador: fiadorPartySchema,
    ...guaranteeBaseFields,
  }),
  z.object({
    tipo: z.literal("seguro_fianca"),
    provider: z.string().min(2), // seguradora
    premioMensal: z.number().nonnegative().optional(),
    ...guaranteeBaseFields,
  }),
  z.object({
    tipo: z.literal("titulo_capitalizacao"),
    provider: z.string().min(2), // PortoCap | Icatu | outro
    valorTitulo: z.number().positive(),
    ...guaranteeBaseFields,
  }),
  z.object({
    tipo: z.literal("caucao"),
    caucaoSubtipo: z.enum(["valor", "veiculo", "carta_fianca", "imovel", "outros"]).default("valor"),
    valorCaucao: z.number().positive().optional(),
    dadosDeposito: z
      .object({
        banco: z.string().optional(),
        agencia: z.string().optional(),
        conta: z.string().optional(),
        dataDeposito: z.coerce.date().optional(),
      })
      .optional(),
    ...guaranteeBaseFields,
  }),
  z.object({
    tipo: z.literal("garantia_digital"),
    provider: z.string().min(2), // credpago | garantti | creditas | ...
    taxaMensal: z.number().nonnegative().optional(),
    ...guaranteeBaseFields,
  }),
  z.object({
    tipo: z.literal("cessao_fiduciaria"),
    provider: z.string().optional(),
    valorCedido: z.number().positive().optional(),
    ...guaranteeBaseFields,
  }),
]);

export type GuaranteeCreateInput = z.infer<typeof guaranteeCreateSchema>;

export const guaranteeUpdateSchema = z.object({
  status: z.enum(GUARANTEE_STATUSES).optional(),
  provider: z.string().optional(),
  coberturaMeses: z.number().int().positive().max(60).optional(),
  externalRef: z.string().optional(),
  custoJson: z.any().optional(),
  dadosJson: z.any().optional(),
  fiadorPartyJson: z.any().optional(),
});

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

// Lifecycle da contratação manual (API-ready): cotacao → em_analise → pendente →
// ativa → vencida/cancelada. "ativa" continua o default de rows criadas direto.
export const INSURANCE_STATUSES = [
  "cotacao",
  "em_analise",
  "pendente",
  "ativa",
  "vencida",
  "cancelada",
] as const;

export const INSURANCE_STATUS_LABELS: Record<string, string> = {
  cotacao: "Cotação",
  em_analise: "Em análise",
  pendente: "Pendente",
  ativa: "Ativa",
  vencida: "Vencida",
  cancelada: "Cancelada",
};

// Coberturas do seguro incêndio (benchmark Superlógica/Porto/Tokio).
export const INSURANCE_COBERTURAS_BASICAS = ["incendio", "raio", "explosao"] as const;
export const INSURANCE_COBERTURAS_ADICIONAIS = [
  "vendaval",
  "danos_eletricos",
  "responsabilidade_civil",
  "perda_aluguel",
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

// Wizard de contratação manual (3 steps). Extensão do create: status explícito,
// cobertura estruturada e geração opcional da despesa mensal (entra no boleto).
export const insuranceWizardSchema = z
  .object({
    leaseContractId: z.string().min(1),
    tipo: z.enum(INSURANCE_TIPOS).default("seguro_incendio"),
    seguradora: z.string().min(2),
    apoliceNumero: z.string().optional(),
    vigenciaInicio: z.coerce.date(),
    vigenciaFim: z.coerce.date(),
    premioMensal: z.number().nonnegative().optional(),
    responsavelPagamento: z
      .enum(["imobiliaria", "locatario", "proprietario"])
      .default("locatario"),
    status: z.enum(INSURANCE_STATUSES).optional(),
    coberturaJson: z
      .object({
        coberturaValor: z.number().positive().optional(),
        basicas: z.array(z.enum(INSURANCE_COBERTURAS_BASICAS)).default([...INSURANCE_COBERTURAS_BASICAS]),
        adicionais: z.array(z.enum(INSURANCE_COBERTURAS_ADICIONAIS)).default([]),
      })
      .optional(),
    gerarDespesa: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.vigenciaFim <= data.vigenciaInicio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "vigenciaFim deve ser posterior a vigenciaInicio.",
        path: ["vigenciaFim"],
      });
    }
    if (data.gerarDespesa && (data.premioMensal === undefined || data.premioMensal <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Gerar despesa mensal exige premioMensal > 0.",
        path: ["premioMensal"],
      });
    }
    // Expense.debitoDe só aceita locatario|proprietario — prêmio pago pela
    // imobiliária não vira despesa do contrato.
    if (data.gerarDespesa && data.responsavelPagamento === "imobiliaria") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Despesa mensal só quando o locatário ou o proprietário paga o prêmio.",
        path: ["gerarDespesa"],
      });
    }
  });

export type InsuranceWizardInput = z.infer<typeof insuranceWizardSchema>;

export const insurancePolicyUpdateSchema = z.object({
  status: z.enum(INSURANCE_STATUSES).optional(),
  seguradora: z.string().min(2).optional(),
  apoliceNumero: z.string().optional(),
  vigenciaInicio: z.coerce.date().optional(),
  vigenciaFim: z.coerce.date().optional(),
  premioMensal: z.number().nonnegative().optional(),
  responsavelPagamento: z.enum(["imobiliaria", "locatario", "proprietario"]).optional(),
  coberturaJson: z.any().optional(),
  externalRef: z.string().optional(),
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

// Laudo (editor web) — shapes TS em lib/locacao/inspection-types.ts.
const laudoFotoSchema = z.object({
  url: z.string().url(),
  legenda: z.string().max(200).optional(),
  uploadedAt: z.string(),
});

const laudoItemSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1).max(120),
  estado: z.enum(["novo", "bom", "regular", "ruim"]),
  observacoes: z.string().max(2000).optional(),
  fotos: z.array(laudoFotoSchema).default([]),
});

const laudoAmbienteSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1).max(120),
  ordem: z.number().int().nonnegative(),
  observacoes: z.string().max(2000).optional(),
  fotos: z.array(laudoFotoSchema).default([]),
  itens: z.array(laudoItemSchema).default([]),
});

const laudoMedidorSchema = z.object({
  leitura: z.string().max(40),
  fotoUrl: z.string().url().optional(),
});

const laudoMetaSchema = z.object({
  medidores: z
    .object({
      agua: laudoMedidorSchema.optional(),
      luz: laudoMedidorSchema.optional(),
      gas: laudoMedidorSchema.optional(),
    })
    .default({}),
  chaves: z
    .array(z.object({ tipo: z.string().min(1).max(80), quantidade: z.number().int().positive() }))
    .default([]),
  mobilia: z
    .array(
      z.object({
        item: z.string().min(1).max(120),
        quantidade: z.number().int().positive(),
        estado: z.string().max(40),
      })
    )
    .default([]),
  observacoesGerais: z.string().max(5000).optional(),
  prazoContestacaoDias: z.number().int().positive().max(60).optional(),
});

export const inspectionUpdateSchema = z.object({
  ambientesJson: z.array(laudoAmbienteSchema).optional(),
  checklistJson: laudoMetaSchema.optional(),
  status: z.enum(["rascunho", "em_campo", "laudo_gerado", "assinatura", "concluida"]).optional(),
  executorId: z.string().nullable().optional(),
});

// Roles ClickSign v3 (espelha lib/clicksign/roles.ts — client-safe lá, Zod aqui).
const clicksignRoleSchema = z.enum([
  "sign",
  "buyer",
  "seller",
  "intervening",
  "realestate",
  "witness",
  "consenting",
  "attorney",
  "party",
]);

export const inspectionSendSignatureSchema = z.object({
  signers: z
    .array(
      z.object({
        name: z.string().min(2),
        email: z.string().email(),
        role: clicksignRoleSchema.default("party"),
        documentation: z.string().optional(),
      })
    )
    .min(1)
    .max(10),
});

export { orgScopeSchema };

// ============================================================================
// LeaseClient — cliente/prospect de locação (cadastro leve pré-deal).
// Campos espelham o form de locação (pessoaFisicaLocacaoSchema), mas TODOS
// opcionais: o objetivo é registrar um lead sem fricção e enriquecer depois.
// ============================================================================

export const leaseClientCreateSchema = z.object({
  tipoPessoa: z.enum(["fisica", "juridica"]).default("fisica"),
  // `nome` é o único campo com um mínimo — sem ele a listagem não faz sentido.
  // Ainda assim aceita string curta; a UI oferece placeholder "Sem nome".
  nome: z.string().trim().min(1, "Informe ao menos um nome").max(200),
  cpfCnpj: z.string().trim().max(20).optional(),
  email: z.string().trim().email("E-mail inválido").optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
  source: z.enum(["manual", "crm", "form"]).default("manual"),
  crmId: z.string().trim().max(120).optional(),
  status: z
    .enum(["novo", "em_analise", "aprovado", "reprovado", "convertido", "arquivado"])
    .default("novo"),
  // Ficha livre (rg, nascimento, endereço, renda, cônjuge, etc). Aditivo.
  dataJson: z.record(z.any()).optional(),
});

export const leaseClientUpdateSchema = leaseClientCreateSchema.partial();

// Fiança por seguradora — status manual nesta entrega.
export const INSURER_STATUSES = [
  "pendente",
  "enviado",
  "em_analise",
  "aprovado",
  "aprovado_com_restricao",
  "recusado",
] as const;

export const insurerAnalysisCreateSchema = z.object({
  seguradora: z.string().trim().min(1).max(80),
  status: z.enum(INSURER_STATUSES).default("pendente"),
  premioMensal: z.number().nonnegative().optional(),
  externalRef: z.string().trim().max(120).optional(),
  resultJson: z.record(z.any()).optional(),
});

export const insurerAnalysisUpdateSchema = insurerAnalysisCreateSchema.partial();

// CRM lookup (stub) — localizar registro externo por ID.
export const crmLookupSchema = z.object({
  entity: z.enum(["cliente", "imovel"]),
  crmId: z.string().trim().min(1, "Informe o ID no CRM").max(120),
});
