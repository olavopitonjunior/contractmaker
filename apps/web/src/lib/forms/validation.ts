import { z } from "zod";
import { collectPartyFormatIssues } from "@/lib/forms/field-formats";
import { isMarried } from "@/lib/forms/estado-civil";

/**
 * Teto das observações gerais do formulário. Existe por dois motivos além de
 * higiene de UI: o dataJson inteiro entra no prompt da análise passiva (sem
 * truncar, diferente do HTML do contrato, que é cortado em 8000 chars), e o
 * texto vem de um formulário público anônimo.
 */
export const OBSERVACOES_MAX = 1500;

// ========= Shared schemas =========

// Recebimento (PIX + dados bancários) do vendedor.
// Migrado em 2026-05-16 de pagamento.parcelas[].pix/bancarios pra cá —
// dados são do vendedor (uma vez), não da parcela individual.
const recebimentoSchema = z.object({
  pix_chave: z.string().optional().default(""),
  pix_tipo_chave: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"]).optional(),
  banco: z.string().optional().default(""),
  agencia: z.string().optional().default(""),
  conta: z.string().optional().default(""),
  tipo_conta: z.enum(["corrente", "poupanca"]).optional(),
}).optional();

const pessoaFisicaSchema = z.object({
  tipo_pessoa: z.literal("fisica"),
  nome: z.string().min(2, "Nome obrigatorio"),
  nacionalidade: z.string().optional().default("Brasileiro(a)"),
  // Sem default silencioso: um "Solteiro(a)" fabricado escondia casados sem
  // outorga conjugal. Ausência fica ausente; a UI exige escolha explícita.
  estado_civil: z.string().optional(),
  profissao: z.string().optional().default(""),
  rg: z.string().optional().default(""),
  cpf: z.string().optional().default(""),
  data_nascimento: z.string().optional().default(""),
  // H.3 (Phase H, 2026-04-18) — exigido pelo TJSP pedido-cível (code 606 sem)
  nome_mae: z.string().optional().default(""),
  // 2026-05-25 — sexo exigido pelo TJSP pedido-certidao p/ PF (code 606
  // "O parâmetro 'genero' não pode ser vazio"). Opcional: ausência vira skip.
  sexo: z.string().optional().default(""),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  mobile_phone: z.string().optional().default(""),
  endereco: z.string().optional().default(""),
  numero: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  uf: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  tem_procurador: z.boolean().optional().default(false),
  recebimento: recebimentoSchema,
  conjuge: z.object({
    nome: z.string().optional().default(""),
    cpf: z.string().optional().default(""),
    rg: z.string().optional().default(""),
    nacionalidade: z.string().optional().default(""),
    profissao: z.string().optional().default(""),
    // Espelha campos pessoais do titular — exigidos por TJSP/PGFN/Antecedentes PF
    data_nascimento: z.string().optional().default(""),
    nome_mae: z.string().optional().default(""),
    sexo: z.string().optional().default(""),
    naturalidade: z.string().optional().default(""),
    email: z.string().email("Email invalido").optional().or(z.literal("")),
    mobile_phone: z.string().optional().default(""),
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
    // Inclusão do cônjuge como signatário ClickSign separado. É OPT-OUT:
    // ausente/`true` inclui, só `false` explícito exclui (gravado quando o
    // operador remove a linha na popup de envio). SEM `.default(false)` de
    // propósito — se algum caller passasse a persistir a saída do parse, o
    // default materializaria `false` em toda parte e anularia o opt-out.
    incluir_como_signatario: z.boolean().optional(),
  }).optional(),
  procurador: z.object({
    nome: z.string().optional().default(""),
    cpf: z.string().optional().default(""),
    rg: z.string().optional().default(""),
    sexo: z.string().optional().default(""),
    // E-mail/celular do procurador — necessários quando ele assina o contrato
    // pela parte (subKind="procurador" no envelope ClickSign).
    email: z.string().email("Email invalido").optional().or(z.literal("")),
    mobile_phone: z.string().optional().default(""),
    endereco: z.string().optional().default(""),
    numero: z.string().optional().default(""),
    cidade: z.string().optional().default(""),
    uf: z.string().optional().default(""),
    // Opt-out, igual ao cônjuge — ver comentário acima. A inclusão real ainda
    // depende de `tem_procurador !== false` em `dealDataToSigners`.
    incluir_como_signatario: z.boolean().optional(),
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
  recebimento: recebimentoSchema,
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
    sexo: z.string().optional().default(""),
    naturalidade: z.string().optional().default(""),
    email: z.string().email("Email invalido").optional().or(z.literal("")),
    mobile_phone: z.string().optional().default(""),
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

// Tipos de parcela (canônicos). `sinal_arras`/`recursos_proprios`/`fgts`/
// `financiamento`/`cessao_consorcio` viram buckets nomeados no contrato via
// enrichContractData. `permuta_*` e `outros` caem em "outras_formas".
const parcelaTipoEnum = z.enum([
  "sinal_arras",
  "recursos_proprios",
  "fgts",
  "financiamento",
  "cessao_consorcio",
  "permuta_veiculo",
  "permuta_imovel",
  "outros",
]);

const parcelaMomentoEnum = z.enum([
  "assinatura",
  "escritura",
  "registro",
  "dias",
  "data_exata",
]);

const parcelaMeioEnum = z.enum([
  "pix",
  "ted",
  "transferencia",
  "boleto",
  "dinheiro",
  "cheque",
  "financiamento",
  "fgts_saque",
  "permuta",
]);

const parcelaSchema = z.object({
  // legado (mantido pra retrocompat com CCV import e contratos em DB)
  tipo_texto: z.string().default(""),
  dias: z.number().default(0),
  valor: z.number().default(0),
  // canônico (form novo)
  tipo: parcelaTipoEnum.optional(),
  tipo_outros_texto: z.string().optional(),
  permuta_descricao: z.string().optional(),
  momento: parcelaMomentoEnum.optional().default("assinatura"),
  data_exata: z.string().optional(),
  meio_pagamento: parcelaMeioEnum.optional(),
  pix: z
    .object({
      chave: z.string().optional(),
      tipo_chave: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"]).optional(),
      titular_nome: z.string().optional(),
      titular_cpf_cnpj: z.string().optional(),
    })
    .optional(),
  bancarios: z
    .object({
      banco: z.string().optional(),
      agencia: z.string().optional(),
      conta: z.string().optional(),
      tipo_conta: z.enum(["corrente", "poupanca"]).optional(),
      titular_nome: z.string().optional(),
      titular_cpf_cnpj: z.string().optional(),
    })
    .optional(),
  banco_financiamento: z.string().optional(),
});

export const step5Schema = z.object({
  modalidade: z.enum(["a_vista", "financiamento"]).default("a_vista"),
  pagamento: z.object({
    valor_total: z.number().min(0).default(0),
    // Buckets derivados via enrichContractData a partir de parcelas[].tipo.
    // Mantidos no schema pra retrocompat — forms antigos editavam direto.
    sinal_arras: z.number().default(0),
    recursos_proprios: z.number().default(0),
    fgts: z.number().default(0),
    cessao_consorcio: z.number().default(0),
    alienacao_fiduciaria: z.number().default(0),
    outras_formas: z.number().default(0),
    meio_pagamento: z.string().optional().default("transferencia bancaria"),
    // Banco do financiamento — subiu de parcela pra nível raiz em 2026-05-16
    // (era redundante por parcela). UI mostra card só quando ≥1 parcela é
    // tipo=financiamento.
    banco_financiamento: z.string().optional(),
    parcelas: z.array(parcelaSchema).optional().default([]),
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
    // Captura na cobrança (Pagadoria) — bias do tipo de cobrança e prazo
    // pós-marco. Default "qualquer" deixa o corretor escolher na hora de
    // gerar a cobrança. `prazo_dias_apos_marco` quando ausente cai na
    // heurística de due-date-resolver.ts (3/30/60 por marco).
    forma_pagamento_preferida: z.enum(["pix", "boleto", "qualquer"]).optional().default("qualquer"),
    prazo_dias_apos_marco: z.number().optional(),
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
      mobile_phone: z.string().optional().default(""),
      percentual: z.number().optional(),
      valor: z.number().optional(),
      // Papel auditável do comissionado na divisão da comissão. Default
      // imobiliaria_principal pra retrocompat com comissionados sintetizados
      // a partir do legado imobiliaria_* (Frente 1).
      papel: z
        .enum(["captador", "intermediador", "indicador", "imobiliaria_principal", "outro"])
        .optional()
        .default("imobiliaria_principal"),
      incluir_como_signatario: z.boolean().optional().default(false),
      // Ligação opcional com SplitRecipient (Pagadoria). Quando setado,
      // composeSplits e deriveComissionados pulam o matching por CPF/CNPJ
      // e usam o id direto. Setado pelo form ao escolher "Selecionar
      // cadastrado" ou após criar inline via POST /api/forms/[token]/commissioners.
      splitRecipientId: z.string().optional(),
    })).optional(),
  }).optional(),
  // `desistencia`, `foro`, `assinatura` e `config` SAÍRAM do formulário público
  // (viraram configuração da imobiliária, na aba "Configurações" do contrato —
  // lib/contracts/default-config.ts). Continuam aceitos aqui, e NÃO opcionais
  // por acaso: forms antigos têm esses campos gravados no dataJson, o schema é
  // usado no finalize pra reportar problemas, e o Zod é non-strict — tirá-los
  // faria a validação ignorá-los, mas o dado permanece. A geração preenche o
  // que faltar via `enrichContractData`.
  desistencia: z.object({
    permite: z.boolean().optional().default(false),
    prazo_dias: z.number().optional().default(7),
  }).optional(),
  foro: z.string().optional(),
  assinatura: z.object({
    cidade: z.string().optional().default(""),
    uf: z.string().optional().default(""),
    data: z.string().optional().default(""),
  }).optional(),
  /**
   * Campo livre no fim do formulário (após testemunhas). Substituiu os campos
   * de configuração contratual que o cliente não deveria decidir.
   *
   * Vai pro resumo enviado à imobiliária e é lido pela IA na análise do
   * contrato — mas como TEXTO DE TERCEIRO, nunca como instrução (o form público
   * é anônimo). Cap de tamanho é defesa: o dataJson entra inteiro no prompt da
   * análise passiva, então texto longo aqui competiria com o contrato.
   */
  observacoes: z.string().max(OBSERVACOES_MAX).optional().default(""),
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
// Fonte única em lib/forms/estado-civil.ts — a comparação literal por rótulo
// vivia copiada em 5 arquivos e nenhuma cópia reconhecia "União estável"
// minúsculo, que é o que os prompts do Gemini pedem ao OCR.
const requiresConjuge = isMarried;

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

    // Regras de FORMATO (2026-06-01): valida campos preenchidos (CPF/CNPJ
    // checksum, nome+sobrenome, nome da mãe, data de nascimento, CEP/UF/telefone)
    // de cada parte e sub-parte (cônjuge/procurador/representante). Campo vazio
    // não bloqueia. Mesma função usada no wizard do cliente — regra única.
    const checkFormats = (list: "vendedores" | "compradores", idx: number, parte: unknown) => {
      for (const issue of collectPartyFormatIssues(parte as Record<string, unknown>)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: [list, idx, ...issue.path.split(".")],
        });
      }
    };
    data.vendedores.forEach((p, i) => checkFormats("vendedores", i, p));
    data.compradores.forEach((p, i) => checkFormats("compradores", i, p));

    // Multi-corretora: soma de percentuais ≤ 100 (apenas quando há
    // comissionados explícitos; campos planos imobiliaria_* não têm percentual)
    const comissionados = data.comissao?.comissionados ?? [];
    if (comissionados.length > 0) {
      const soma = comissionados.reduce(
        (acc, c) => acc + (c.percentual ?? 0),
        0
      );
      if (soma > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Soma dos percentuais dos comissionados é ${soma.toFixed(2)}% (máximo 100%)`,
          path: ["comissao", "comissionados"],
        });
      }

      // A3 (QA deal 20486): inconsistência — há comissionado com participação
      // (percentual ou valor) mas a comissão TOTAL ficou 0. Renderiza
      // "R$ 0,00 (zero reais)" no contrato. Só dispara quando há sinal de
      // comissão real (não bloqueia negócios genuinamente sem corretagem).
      const valorComissao = Number(data.comissao?.valor ?? 0);
      const temParticipacao = comissionados.some(
        (c) => (c.percentual ?? 0) > 0 || (c.valor ?? 0) > 0
      );
      if (temParticipacao && valorComissao <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Há comissionado com participação informada, mas o valor total da comissão está zerado. Informe o valor da comissão.",
          path: ["comissao", "valor"],
        });
      }
    }

    // Pagamento: soma das parcelas == valor_total (tolerância 0.01).
    // Só aplica quando ambos > 0 — formulários em rascunho ficam livres.
    const valorTotal = data.pagamento?.valor_total ?? 0;
    const parcelas = data.pagamento?.parcelas ?? [];
    const somaParcelas = parcelas.reduce(
      (acc, p) => acc + (Number(p.valor) || 0),
      0
    );
    if (valorTotal > 0 && somaParcelas > 0 && Math.abs(valorTotal - somaParcelas) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Soma das parcelas (R$ ${somaParcelas.toFixed(2)}) difere do valor total (R$ ${valorTotal.toFixed(2)})`,
        path: ["pagamento", "parcelas"],
      });
    }
  });

export type DadosContratoForm = z.infer<typeof dadosContratoSchema>;

export const STEP_LABELS = [
  "Documentos",
  "Vendedor(es)",
  "Comprador(es)",
  "Imóvel(is)",
  "Posse/Propriedade",
  "Pagamento",
  // Era "Comissão e Config": as configurações contratuais migraram pra aba
  // "Configurações" do editor de contrato.
  "Comissão e Testemunhas",
] as const;

// Campos obrigatórios por etapa — array LEGADO mantido pra retrocompat.
// A fonte canônica passou pra `lib/forms/presets.ts` que resolve baseado em
// OrgFormSettings.preset. Este array é referenciado pelo preset "legado"
// (default em orgs criadas antes da migração 20260515120000_org_form_settings).
// NÃO mexer aqui — mudar este array afeta orgs legadas sem aviso.
// Atualizado 2026-05-16: 8→7 etapas (merge Posse/Título no Status/Débitos).
// Slot Posse era `[]` em todos os presets, então nenhuma org perde required path.
export const STEP_REQUIRED_FIELDS_LEGACY: ReadonlyArray<ReadonlyArray<string>> = [
  [],
  ["vendedores"],
  ["compradores"],
  ["imoveis.0.rua", "imoveis.0.cidade", "imoveis.0.uf", "imoveis.0.descricao"],
  [],
  ["pagamento.valor_total"],
  [],
] as const;

// Alias mantido pra qualquer caller legado durante a transição.
// Novos callers devem usar `resolveRequiredFields(orgFormSettings, stepIndex)`
// de `lib/forms/presets.ts`.
export const STEP_REQUIRED_FIELDS = STEP_REQUIRED_FIELDS_LEGACY;
