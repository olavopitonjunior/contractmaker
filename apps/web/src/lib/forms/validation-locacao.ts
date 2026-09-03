import { z } from "zod";
import {
  collectPartyFormatIssues,
  isValidBirthdate,
} from "@/lib/forms/field-formats";
import { isMarried } from "@/lib/forms/estado-civil";
import { comissionadoRecebimentoSchema } from "@/lib/forms/commissioner-receiving";
import { OBSERVACOES_MAX } from "@/lib/forms/validation";
import { normalizeGarantiaTipo } from "@/lib/contracts/template-category";

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
  // Sem default silencioso (ver validation.ts) — evita casado sem outorga.
  estado_civil: z.string().optional(),
  profissao: z.string().optional().default(""),
  rg: z.string().optional().default(""),
  cpf: z.string().optional().default(""),
  data_nascimento: z.string().optional().default(""),
  // 2026-09-03 — mesmos nomes da venda (validation.ts), que o planner de
  // certidões lê: sem `nome_mae`/`sexo` a certidão TJSP mais útil para crédito
  // (pedido-certidao, cível + execução fiscal) nunca dispara em SP — cai no
  // pedido-civel só-cível — e antecedentes PF nem entra. Opcionais: ausência
  // vira skip "complete os dados", não erro.
  nome_mae: z.string().optional().default(""),
  sexo: z.string().optional().default(""),
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
  // Cônjuge (2026-07-24). Locação não tinha outorga uxória em camada nenhuma:
  // um locador casado assinava sozinho. Espelha o sub-objeto de venda menos
  // nome_mae/sexo/naturalidade. Desde 2026-09-02 o cônjuge do FIADOR é alvo de
  // certidão (planner de locação) e sem sexo/nome_mae cai em skip "complete os
  // dados" sem campo no form — dívida declarada, a tratar no PR da aba.
  // `incluir_como_signatario` default `true` como o resto de locação (venda
  // nasceu opt-in por motivos históricos).
  conjuge: z.object({
    nome: z.string().optional().default(""),
    cpf: z.string().optional().default(""),
    rg: z.string().optional().default(""),
    nacionalidade: z.string().optional().default(""),
    profissao: z.string().optional().default(""),
    data_nascimento: z.string().optional().default(""),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    mobile_phone: z.string().optional().default(""),
    // Endereço próprio — só usado quando endereco_igual_ao_titular === false.
    endereco: z.string().optional().default(""),
    numero: z.string().optional().default(""),
    complemento: z.string().optional().default(""),
    bairro: z.string().optional().default(""),
    cidade: z.string().optional().default(""),
    uf: z.string().optional().default(""),
    cep: z.string().optional().default(""),
    endereco_igual_ao_titular: z.boolean().optional().default(true),
    incluir_como_signatario: z.boolean().optional().default(true),
  }).optional(),
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
  // Situação da matrícula + vínculo com o FormAttachment escolhido, espelhando
  // venda (`validation.ts`): quem preenche pode anexar/escolher a matrícula na
  // PRÓPRIA etapa do imóvel e extrair número, cartório e descrição dali, em vez
  // de voltar à etapa 0.
  matricula_situacao: z.string().optional().default(""),
  matricula_attachment_id: z.string().optional().default(""),
  matricula_attachment_filename: z.string().optional().default(""),
  inscricao_iptu: z.string().optional().default(""),
  area: z.number().optional().default(0),
  // Detalhes do prédio/condomínio (cláusula DO IMÓVEL do template v3).
  vagas_garagem: z.number().int().min(0).optional(),
  condominio_nome: z.string().optional().default(""),
  // Opcional desde 2026-08: a corretora pediu que saísse do caminho crítico —
  // o campo virava discussão de negociação ("mobiliado?", "aceita pet?") num
  // formulário que só precisa identificar o imóvel. Quem quiser exigir liga
  // pelo preset de obrigatoriedade da org.
  descricao: z.string().optional().default(""),
});

// Reajuste e vigência.
const aluguelSchema = z.object({
  valor: z.number().min(0).default(0),
  // Encargos embutidos no boleto mensal — TOTAL. Desde 2026-07 é a SOMA
  // derivada de condominio_mensal + iptu_mensal + outros_encargos (o form
  // grava o total aqui). Continua sendo o campo lido por
  // createLeaseContractFromDataJson → LeaseContract.valorEncargos e pelo
  // RentCharge, então não muda de nome nem de significado pros forms antigos.
  encargos: z.number().optional().default(0),
  dia_vencimento: z.number().min(1).max(28).optional().default(10),
  indice_reajuste: z.enum(["IGPM", "IPCA", "outro"]).optional().default("IGPM"),
  vigencia_inicio: z.string().optional().default(""),
  vigencia_meses: z.number().optional().default(30),
  taxa_admin_percent: z.number().optional().default(10),
  // Forma de pagamento preferida do aluguel mensal.
  meio_pagamento: z.enum(["pix", "boleto", "qualquer"]).optional().default("pix"),
  // Itens de ENTRADA dos encargos lançados no mesmo boleto pela administradora
  // (cláusula de encargos do template v3). A soma dos três alimenta `encargos`.
  iptu_mensal: z.number().min(0).optional(),
  condominio_mensal: z.number().min(0).optional(),
  // Aditivo (2026-07): terceiro item da soma — taxa de lixo, seguro incêndio,
  // rateio de obra etc. Também é o destino do valor legado quando um form
  // antigo tinha `encargos` digitado à mão e nenhum item detalhado.
  outros_encargos: z.number().min(0).optional().default(0),
  // ==========================================================================
  // Aditivos 2026-08: decisão de ADMINISTRAÇÃO no form público (etapa 4).
  // Sem default de propósito (ausente = form antigo, cláusulas seguem como
  // antes). No finalize, espelham em fiscal.*/LeaseContract — o operador segue
  // podendo sobrescrever no diálogo "Dados da administração".
  // ==========================================================================
  // "A locação terá administração pela imobiliária?"
  adm_imobiliaria: z.boolean().optional(),
  // Com administração: a imob PAGA os encargos e retém no repasse ao
  // proprietário, ou repassa integral pro locatário pagar junto do aluguel.
  // Dirige a cláusula de encargos (9.1.2) do template v3.
  encargos_repasse: z.enum(["paga_e_retem", "repasse_integral"]).optional(),
  // Contas de consumo (água/luz/gás), quando há condomínio: individualizadas
  // (transferem de titularidade — cláusula 9.3 atual) ou somando no boleto do
  // condomínio (sem transferência; pagas via condomínio).
  contas_consumo_individualizadas: z.boolean().optional(),
  contas_no_condominio: z.array(z.enum(["agua", "luz", "gas"])).optional(),
});

/**
 * Itens de entrada dos encargos mensais (aluguel.*). Valores frouxos porque a
 * chamada vem tanto do form (números) quanto de um dataJson cru (unknown).
 */
export type EncargosItens = {
  iptu_mensal?: unknown;
  condominio_mensal?: unknown;
  outros_encargos?: unknown;
};

/**
 * Total mensal de encargos = condomínio + IPTU + outros. Fonte única da soma
 * (UI do form e testes). Arredonda a 2 casas pra não vazar float (0.1+0.2).
 */
export function sumEncargosMensais(itens: EncargosItens | null | undefined): number {
  if (!itens) return 0;
  const parcela = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const total =
    parcela(itens.condominio_mensal) +
    parcela(itens.iptu_mensal) +
    parcela(itens.outros_encargos);
  return Math.round(total * 100) / 100;
}

/**
 * Migração suave dos encargos ao ABRIR um form antigo (ou vindo do OCR), onde
 * `encargos` era um total digitado à mão. Devolve o novo `outros_encargos` que
 * faz a soma dos itens bater com esse total, ou `null` quando não há nada a
 * migrar (form novo, ou itens já cobrindo o total). Puro — o componente só
 * aplica o resultado.
 */
export function seedOutrosEncargos(
  aluguel: (EncargosItens & { encargos?: unknown }) | null | undefined
): number | null {
  if (!aluguel) return null;
  const legado = Number(aluguel.encargos);
  if (!Number.isFinite(legado) || legado <= 0) return null;
  const soma = sumEncargosMensais(aluguel);
  if (legado <= soma) return null;
  const outrosAtual = Number(aluguel.outros_encargos);
  const base = Number.isFinite(outrosAtual) && outrosAtual > 0 ? outrosAtual : 0;
  return Math.round((base + legado - soma) * 100) / 100;
}

// Garantia locatícia (art. 37 Lei 8.245). Fiador só quando tipo="fiador".
const garantiaSchema = z.object({
  // LÊ o legado, GRAVA o canônico: `garantia_digital` foi renomeado pra
  // `garantia_onerosa` e um rascunho salvo antes disso ainda chega aqui com o
  // valor antigo — sem o preprocess ele seria rejeitado pelo enum e o form
  // inteiro ficaria inválido. Ver `normalizeGarantiaTipo`.
  tipo: z.preprocess(
    (v) => (typeof v === "string" ? (normalizeGarantiaTipo(v) ?? v) : v),
    z
      .enum([
        "fiador",
        "caucao",
        "seguro_fianca",
        "garantia_onerosa",
        "titulo_capitalizacao",
        "propria",
        "sem_garantia",
      ])
      .optional()
      .default("caucao")
  ),
  // Subscritora do título / seguradora / provedora da garantia onerosa.
  provider: z.string().optional().default(""),
  cobertura_meses: z.number().optional().default(0),
  // Seguro-fiança / garantia onerosa: quem contrata a apólice e por quanto
  // tempo ela vale. Sem `.default()` de propósito — o padrão de mercado varia
  // por seguradora e por imobiliária, então quem preenche escolhe; ausente, o
  // enrich não deriva texto nenhum e a cláusula segue genérica.
  // "" é o "limpo" que a troca de modalidade grava (auto-save + deepMerge não
  // sabem apagar chave — ver GARANTIA_MODALIDADE_RESET); vira undefined aqui.
  seguro_tomador: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["inquilino", "proprietario"]).optional()
  ),
  seguro_vigencia: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["anual_renovavel", "prazo_contrato"]).optional()
  ),
  // Caução: nº de aluguéis depositados (art. 38 §2º — máx 3).
  caucao_meses: z.number().optional().default(0),
  // Título de capitalização caucionado (art. 37, II): valor nominal + proposta.
  titulo_valor: z.number().min(0).optional(),
  titulo_proposta: z.string().optional().default(""),
  fiador: parteLocacaoSchema.optional(),
});

// ============================================================================
// Config fiscal/operacional (A7-A16) — preenchida pelo OPERADOR, não pelo
// cliente. Espelha os campos que o wizard interno (NovoContratoWizard /
// api/locacao/contracts/wizard) já coleta e que dirigem repasse/DIMOB/cobrança
// — NÃO entram no texto do contrato de LOCAÇÃO (template), mas alimentam o
// LeaseContract (ver createLeaseContractFromDataJson).
//
// O subconjunto que o instrumento de ADMINISTRAÇÃO precisa (taxa de adm, IR,
// regime de cobrança, NFS-e) saiu do diálogo de criação do formulário e passou
// a ser coletado no diálogo que precede a geração daquele contrato — é ali que
// a relação imobiliária ↔ proprietário é acertada. Ver
// `PATCH /api/locacao/deals/[dealId]/fiscal`.
// ============================================================================
export const fiscalAdministracaoSchema = z.object({
  taxa_admin_percent: z.number().min(0).max(100).optional().default(10),
  regime_ir: z
    .enum(["nao_retem", "retem_sem_controle", "retem_imobiliaria", "retem_inquilino"])
    .optional()
    .default("nao_retem"),
  regime_cobranca: z.enum(["mes_vencido", "mes_a_vencer"]).optional().default("mes_a_vencer"),
  emitir_nfse: z.boolean().optional().default(false),
});

export type FiscalAdministracao = z.infer<typeof fiscalAdministracaoSchema>;

const fiscalSchema = fiscalAdministracaoSchema.extend({
  isencao_multa_meses: z.number().int().min(0).optional().default(0),
  repasse_garantido: z
    .enum(["nao", "alguns_meses", "todo_contrato"])
    .optional()
    .default("nao"),
  repasse_garantido_meses: z.number().int().min(0).optional(),
});

// Angariador (A11) — corretor captador com comissão RECORRENTE sobre o aluguel
// (percentual do aluguel OU valor fixo, × `meses_comissao`). `meses_comissao`
// null/0 = todo o contrato. Não confundir com `taxa_locacao_percent` (comissão
// de CORRETAGEM, one-shot sobre o 1º aluguel).
//
// Os campos de qualificação (tipo_pessoa/cpf/cnpj/creci/email/mobile_phone) são
// ADITIVOS (2026-07): `materializeLeaseParties` já lia `a.cpf || a.cnpj` do
// dataJson antes de existir UI, e `splitRecipientId` é o backfill do registry
// de corretores (SplitRecipient kind="commissioner"), espelhando
// `comissao.comissionados[]` de venda.
export const angariadorLocacaoSchema = z.object({
  party_id: z.string().optional(),
  /** Backfill do registry (lib/asaas/commissioner-registry.ts). */
  splitRecipientId: z.string().optional(),
  // Estado do cadastro no registry: `true` = SplitRecipient sem meio de
  // repasse (`pendingFields` não vazio). Continua sendo só um BOOLEANO, e segue
  // servindo aos formulários em circulação, cujos dados bancários vivem apenas
  // no cadastro (ver `linhaSatisfeita`).
  recebimentoPendente: z.boolean().optional(),
  // Dados bancários do corretor — mesmo shape e mesmas obrigações da esteira de
  // venda: redação por leitor em toda superfície de leitura e ausência no
  // resumo. Ver `lib/forms/commissioner-receiving.ts`.
  recebimento: comissionadoRecebimentoSchema.optional(),
  nome: z.string().min(2, "Nome do angariador obrigatório"),
  tipo_pessoa: z.enum(["fisica", "juridica"]).optional().default("fisica"),
  cpf: z.string().optional().default(""),
  cnpj: z.string().optional().default(""),
  creci: z.string().optional().default(""),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  mobile_phone: z.string().optional().default(""),
  forma_comissao: z.enum(["percentual", "valor_fixo"]).optional().default("percentual"),
  percentual: z.number().min(0).max(100).optional(),
  valor_fixo: z.number().min(0).optional(),
  meses_comissao: z.number().int().min(0).optional(),
  /**
   * Quanto DESTE corretor sai do PRIMEIRO aluguel, pago diretamente a ele.
   *
   * Aditivo (2026-09). Existe porque a cláusula de rateio do 1º aluguel —
   * "a) R$ X à imobiliária; b) R$ Y ao corretor; c) R$ Z ao corretor" — não
   * tinha onde guardar os itens b) e c): a comissão recorrente
   * (`percentual`/`valor_fixo` × `meses_comissao`) responde "quanto por mês",
   * não "quanto do primeiro aluguel vai direto para quem captou".
   *
   * Ausente = usa a comissão do mês 1 como valor (é o caso comum, e é o que o
   * campo anuncia como padrão). A parte da imobiliária é a taxa de locação
   * MENOS a soma destes valores: os corretores recebem de DENTRO da taxa —
   * regra decidida pelo dono do produto em 03/09/2026, e é o que a cláusula
   * real reflete, com a soma dos itens fechando um aluguel inteiro.
   */
  valor_primeiro_aluguel: z.number().min(0).optional(),
});

// Comissão da imobiliária — taxa de locação cobrada à vista (1º aluguel) +
// angariadores. Base dos boletos de comissão (ver aba Cobrança do deal).
export const comissaoLocacaoSchema = z.object({
  /**
   * Como a taxa de locação é cobrada. O angariador já tinha as duas formas
   * desde sempre; a taxa da IMOBILIÁRIA só existia em percentual — e uma
   * imobiliária que cobra "R$ 800 fixos pela intermediação" não tinha onde
   * dizer isso.
   */
  forma_taxa_locacao: z
    .enum(["percentual", "valor_fixo"])
    .optional()
    .default("percentual"),
  /** % sobre o 1º aluguel (usado quando forma = percentual). */
  taxa_locacao_percent: z.number().min(0).max(100).optional().default(0),
  /** R$ à vista (usado quando forma = valor_fixo). */
  taxa_locacao_valor: z.number().min(0).optional(),
  angariadores: z.array(angariadorLocacaoSchema).optional().default([]),
});

export type AngariadorLocacao = z.infer<typeof angariadorLocacaoSchema>;
export type ComissaoLocacao = z.infer<typeof comissaoLocacaoSchema>;

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
        // "Haverá cláusula rescisória?" (etapa Garantia). false = o contrato
        // sai SEM a cláusula de multa por rescisão antecipada; default true
        // preserva forms antigos e o comportamento padrão do template v3.
        clausula_rescisoria: z.boolean().default(true),
      })
      .default({}),
    // Operador-only (não renderizadas no template): config fiscal + comissão.
    fiscal: fiscalSchema.optional(),
    comissao: comissaoLocacaoSchema.optional(),
    // Campo livre no fim do wizard (etapa Garantia) — paridade com venda.
    // Mesmo contrato de leitura: resumo pra imobiliária + IA como DADO cercado
    // em <observacoes_form> (nunca instrução; o form público é anônimo). Cap
    // compartilhado com venda (o dataJson entra inteiro no prompt da análise).
    observacoes: z.string().max(OBSERVACOES_MAX).optional().default(""),
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
//
// A etapa "Confirmação e Assinatura" saiu em 2026-07-30: ela coletava só
// cidade/UF/data de assinatura e foro — todos com fallback pronto no
// `enrichLocacaoData` (padrão da org > cidade do imóvel). Na prática o cliente
// abandonava o formulário na última tela. Cidade/UF viraram configuração da
// imobiliária (aba Locação do padrão contratual); a data continua por negócio;
// o consentimento LGPD continua no wizard (`isLastStep`).
// 2026-09-03: Locatário passou à frente do Locador (etapa 1). Quem preenche o
// formulário costuma ser a imobiliária COM o candidato à locação na frente — o
// locador já é conhecido do cadastro. A ordem anterior obrigava a começar pela
// parte que raramente está na mesa.
//
// O índice da etapa é IDENTIDADE PERSISTIDA, não só posição: ele vive em
// `OrgFormSettings.locacaoCustomRequiredPaths[].step` e em
// `participantVisibilityJson.locacao.<papel>[]`. Trocar as posições aqui sem
// remapear o que está gravado faria uma org configurada exigir campos na etapa
// errada. A migration `20260903_locacao_swap_locador_locatario` cuida disso, e
// ela RECALCULA o step a partir do próprio path (em vez de trocar 1↔2), para
// ser idempotente — um swap literal se desfaz se rodar duas vezes.
export const LOCACAO_STEP_LABELS = [
  "Documentos",
  "Locatário(s)",
  "Locador(es)",
  "Imóvel",
  "Aluguel e Reajuste",
  "Garantia e Observações",
  // 2026-08: paridade com venda — comissão/angariadores no form público
  // (token principal apenas; subtokens não incluem o índice 6).
  "Comissão",
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
        // "Haverá cláusula rescisória?" (etapa Garantia). false = o contrato
        // sai SEM a cláusula de multa por rescisão antecipada; default true
        // preserva forms antigos e o comportamento padrão do template v3.
        clausula_rescisoria: z.boolean().default(true),
      })
      .default({}),
    fiscal: fiscalSchema.optional(),
    comissao: comissaoLocacaoSchema.optional(),
    // Espelha o residencial — ver comentário em dadosLocacaoSchema.
    observacoes: z.string().max(OBSERVACOES_MAX).optional().default(""),
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
  "Garantia e Observações",
  "Comissão",
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

/**
 * Bloqueio DURO do finalize de locação.
 *
 * Existe porque o piso de obrigatoriedade do `LocacaoFormWizard` (nome da
 * parte, valor do aluguel) deixou de valer sempre: ele passou a ceder à
 * configuração da imobiliária. O piso era client-side e, portanto, nunca foi
 * garantia de verdade — mas era o que na prática impedia finalizar uma locação
 * com parte sem nome (que `dealDataToSigners` joga em `missing`, e a parte não
 * assina na ClickSign) ou com aluguel zero. Ao afrouxar o piso sem isto aqui, a
 * trava visível viraria contrato quebrado na assinatura.
 *
 * ESTREITO DE PROPÓSITO: só AUSÊNCIA de dado estrutural. Problema de FORMATO
 * (o CPF que o OCR trouxe torto) continua em `collectLocacaoFinalizeIssues`,
 * como warning na resposta — o cliente não pode ficar preso por isso. Não
 * transformar aquela lista inteira em bloqueio.
 *
 * Fiador fica FORA: já tem guarda própria (`missingFiadorName`) com `reason`
 * dedicado na rota, e é condicional ao tipo de garantia.
 */
const HARD_BLOCK_LISTS = [
  ["locadores", "locador"],
  ["locatarios", "locatário"],
] as const;

/**
 * Os paths que o bloqueio duro exige, PREENCHIDOS OU NÃO.
 *
 * Existe separado de `collectLocacaoHardBlockIssues` porque o wizard precisa
 * das duas leituras e elas não podem divergir: a lista abaixo acende o
 * asterisco (o campo é exigido para CONCLUIR, sempre — nenhuma configuração
 * desliga isso), e o `collect` filtra dela o que está vazio para barrar. Duas
 * listas escritas à mão iam separar-se na primeira mudança.
 */
export function locacaoHardBlockPaths(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [list] of HARD_BLOCK_LISTS) {
    const parties = Array.isArray(data[list])
      ? (data[list] as Array<Record<string, unknown> | null | undefined>)
      : [];
    // Lista vazia: o próprio path da lista é a pendência ("informe ao menos um").
    if (parties.length === 0) {
      out.push(list);
      continue;
    }
    parties.forEach((raw, i) => {
      // Mesmo par PF/PJ do piso do wizard: numa PJ o campo de identidade é a
      // razão social, e cobrar `nome` ali seria pendência num campo que a
      // ficha de empresa nem renderiza.
      out.push(
        `${list}.${i}.${(raw ?? {}).tipo_pessoa === "juridica" ? "razao_social" : "nome"}`
      );
    });
  }
  out.push("aluguel.valor");
  return out;
}

/** Mensagem por path, derivada da forma do path (sem segunda tabela). */
function hardBlockMessage(path: string): string {
  if (path === "aluguel.valor") {
    return "Informe o valor do aluguel (maior que zero).";
  }
  const [list, , field] = path.split(".");
  const label = HARD_BLOCK_LISTS.find(([l]) => l === list)?.[1] ?? "parte";
  if (!field) return `Informe ao menos um ${label}.`;
  return field === "razao_social"
    ? `Razão social do ${label} é obrigatória.`
    : `Nome do ${label} é obrigatório.`;
}

export function collectLocacaoHardBlockIssues(
  data: Record<string, unknown>
): FinalizeIssue[] {
  return locacaoHardBlockPaths(data)
    .filter((path) => {
      if (path === "aluguel.valor") {
        const aluguel = (data.aluguel as Record<string, unknown> | undefined) ?? {};
        // Zero é ausência aqui, não resposta — o Zod dá `.default(0)` ao campo.
        return !(Number(aluguel.valor) > 0);
      }
      const [list, idx, field] = path.split(".");
      // Path de lista (sem índice) só é gerado quando a lista está vazia.
      if (!field) return true;
      const parties = (data[list] as Array<Record<string, unknown>>) ?? [];
      return isBlankStr(parties[Number(idx)]?.[field]);
    })
    .map((path) => ({ path, message: hardBlockMessage(path) }));
}

/** Erro de veto do finalize — lançado de dentro do lock, vira 422 na rota. */
export class LocacaoFinalizeBlockedError extends Error {
  constructor(public readonly issues: FinalizeIssue[]) {
    super("LOCACAO_FINALIZE_BLOCKED");
    this.name = "LocacaoFinalizeBlockedError";
  }
}

/**
 * Veta o finalize quando falta dado estrutural. Feito para rodar DENTRO do
 * `transform` de `mergeSalesFormDataJson`, que roda sob o row lock sobre o
 * estado RESULTANTE do merge: medir o `preview` pré-lock deixaria passar o
 * finalize que corre junto com um auto-save de outra aba/subtoken. Lançar aqui
 * aborta a transação — nada é gravado, nem o `status`.
 */
export function assertLocacaoFinalizable(data: Record<string, unknown>): void {
  const issues = collectLocacaoHardBlockIssues(data);
  if (issues.length > 0) throw new LocacaoFinalizeBlockedError(issues);
}

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

  // Administração pela imobiliária: com "sim", a forma de trânsito dos
  // encargos é obrigatória (dirige a cláusula de encargos do contrato).
  if (aluguel.adm_imobiliaria === true && isBlankStr(aluguel.encargos_repasse)) {
    issues.push({
      path: "aluguel.encargos_repasse",
      message:
        "Com administração pela imobiliária, informe se os encargos são pagos e retidos ou repassados integralmente.",
    });
  }
  // Contas de consumo não individualizadas: precisa dizer QUAIS somam no
  // boleto do condomínio (a cláusula 9.3 lista).
  if (
    aluguel.contas_consumo_individualizadas === false &&
    !(Array.isArray(aluguel.contas_no_condominio) && aluguel.contas_no_condominio.length > 0)
  ) {
    issues.push({
      path: "aluguel.contas_no_condominio",
      message: "Informe quais contas de consumo entram no boleto do condomínio.",
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
    // Outorga uxória: parte PF casada precisa de nome + CPF do cônjuge. Mesma
    // regra que o superRefine de venda aplica (lib/forms/validation.ts). Fica
    // aqui, e não nos dois superRefine de locação, pra não triplicar o código.
    // E-mail do cônjuge NÃO entra: é recomendação no wizard, não bloqueio.
    for (const issue of collectConjugeIssues(parte as Record<string, unknown>)) {
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
    for (const issue of collectConjugeIssues(fiador)) {
      issues.push({ path: `garantia.fiador.${issue.path}`, message: issue.message });
    }
  }

  return issues;
}

/**
 * Nome + CPF do cônjuge quando a parte PF é casada ou vive em união estável.
 * Sem a outorga do cônjuge a locação de imóvel comum é anulável — mesma regra
 * já aplicada em venda.
 */
function collectConjugeIssues(parte: Record<string, unknown>): FinalizeIssue[] {
  if (parte.tipo_pessoa === "juridica") return [];
  if (!isMarried(parte.estado_civil)) return [];
  const conjuge = (parte.conjuge as Record<string, unknown> | undefined) ?? {};
  const out: FinalizeIssue[] = [];
  if (isBlankStr(conjuge.nome)) {
    out.push({
      path: "conjuge.nome",
      message: "Nome do cônjuge é obrigatório quando a parte é casada.",
    });
  }
  if (isBlankStr(conjuge.cpf)) {
    out.push({
      path: "conjuge.cpf",
      message: "CPF do cônjuge é obrigatório quando a parte é casada.",
    });
  }
  return out;
}

export function stepLabelsForLocacaoType(schemaType: string) {
  return schemaType === LOCACAO_COMERCIAL_SCHEMA_TYPE
    ? LOCACAO_COMERCIAL_STEP_LABELS
    : LOCACAO_STEP_LABELS;
}
