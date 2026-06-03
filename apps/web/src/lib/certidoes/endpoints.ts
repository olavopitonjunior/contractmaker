/**
 * Catalog of Infosimples endpoints used by Contractmaker.
 * Cost in cents of R$ (4 = R$ 0,04). Used for budget estimates + reporting.
 *
 * F1 metadata: each endpoint is tagged with scope/uf/category/appliesTo so the
 * planner can filter endpoints declaratively (no hardcoded switch) and the
 * picker UI can group them by scope and filter by UF.
 */

export type EndpointScope = "federal" | "estadual" | "municipal" | "serasa";
export type EndpointCategory =
  | "civel"
  | "trabalhista"
  | "fiscal"
  | "protesto"
  | "municipal"
  | "federal"
  | "registro"    // Registro de imóveis: matrícula ONR/ARISP, ONR Mapa, CCIR rural
  | "cadastro"    // Phase B: Cartão CNPJ, CPF situation — informational dumps
  | "fgts"        // Phase B: CRF FGTS (Caixa) — labor-adjacent regulatory
  | "score"       // Serasa: Score de crédito (0-1000)
  | "negativacao" // Serasa: Restritivos (Pefin/Refin, protestos, ações)
  | "vinculos";   // Serasa: vínculos PJ↔PF (sociedades, representação)
export type EndpointProvider = "infosimples" | "serasa";
export type EndpointAppliesTo = "pessoa" | "imovel";

export interface EndpointInfo {
  id: string;
  label: string;
  costCents: number;
  twoStep?: boolean;
  initialStatus?: "pending" | "awaiting_portal";
  /** F1: scope of the jurisdiction */
  scope: EndpointScope;
  /** F1: 2-letter UF code, only for estadual/municipal */
  uf?: string;
  /** F1: valid targets for this endpoint */
  appliesTo: EndpointAppliesTo[];
  /** F1: semantic category for filtering in the picker UI */
  category: EndpointCategory;
  /**
   * Provider que serve o endpoint. Default `infosimples` mantém retrocompat
   * com o catálogo legado. O executor faz switch por este campo —
   * `serasa` chama `lib/serasa/client.ts::callSerasa` com OAuth2 + cache;
   * `infosimples` segue o caminho histórico via `callInfosimples`.
   */
  provider?: EndpointProvider;
  /** F1: tooltip shown in the picker */
  description?: string;
  /** F.II-γ: endpoint só dispara se checkGovBrAuth() retornar active=true */
  requiresGovBrAuth?: boolean;
  /**
   * ONR/ARISP: endpoint usa as credenciais do portal de Registradores (login/
   * senha ou certificado A1) — separadas do INFOSIMPLES_TOKEN — e debita o
   * SALDO do portal ONR. Só dispara se checkOnrAuth() retornar active=true;
   * caso contrário o planner emite SkippedJob orientando configurar em Settings.
   * As credenciais são injetadas centralmente em callInfosimples (nunca no
   * requestPayload persistido).
   */
  requiresOnrAuth?: boolean;
  /**
   * J.1 (Phase J, 2026-04-18) — override de `CATEGORIES_REQUIRING_PDF`:
   * quando `false`, endpoint é tratado como informativo (resposta é JSON,
   * não emite PDF). Default: herdado da category (true para civel/trabalhista/
   * fiscal/protesto/municipal/federal). Exemplos: `trf/cert-unificada`
   * retorna status agregado dos 6 TRFs em JSON, sem PDF — emitsPdf: false.
   */
  emitsPdf?: boolean;
  /**
   * J.5 (Phase J, 2026-04-18) — URL oficial do portal para extração manual
   * como último recurso quando o endpoint Infosimples falha permanentemente
   * (code 602 deprecated ou retries esgotados). UI renderiza como CTA
   * "Abrir portal oficial".
   */
  portalUrl?: string;
  /**
   * J.4 (Phase J, 2026-04-18) — tempo esperado em `awaiting_portal` antes
   * do 2º step (obter-certidao) ficar pronto. Usado pra exibir ETA no card
   * ("Pronto em ~15 min" / "Pronto em até 5 dias úteis").
   */
  expectedWaitMinutes?: number;
  /**
   * Endpoint encadeado internamente pelo executor (não selecionável no picker
   * nem emitido pelo planner como PlannedJob). Ex.: `ieptb/protestos-detalhes-sp`
   * é disparado como follow-up síncrono a partir do resultado de `ieptb/protestos`.
   */
  internalOnly?: boolean;
}

/**
 * H.1 + H.4 (Phase H, 2026-04-18) — categorias que normalmente emitem PDF.
 * Usado pelo executor para marcar jobs como failed quando code=200 +
 * situacao="negativa"/"positiva" mas sem site_receipts[0] (CENPROT SP 200
 * sem PDF foi o caso). Categorias `cadastro` e `fgts` são informativas
 * (dump de cadastro), não emitem certidão anexada.
 */
export const CATEGORIES_REQUIRING_PDF: ReadonlySet<EndpointCategory> = new Set([
  "civel",
  "trabalhista",
  "fiscal",
  "protesto",
  "municipal",
  "federal",
]);

export const ENDPOINTS: Record<string, EndpointInfo> = {
  // --- Federal ---
  "receita-federal/pgfn": {
    id: "receita-federal/pgfn",
    label: "CND Federal + Divida Ativa",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Certidao conjunta de debitos federais e divida ativa da Uniao (Receita Federal + PGFN)",
    portalUrl: "https://servicos.receitafederal.gov.br/servico/certidoes",
  },
  "tribunal/tst/cndt": {
    id: "tribunal/tst/cndt",
    label: "CNDT (Trabalhista)",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Negativa de Debitos Trabalhistas (TST, nacional)",
    portalUrl: "https://cndt-certidao.tst.jus.br/",
  },
  "tribunal/trf/cert-unificada": {
    id: "tribunal/trf/cert-unificada",
    label: "Certidao Civel Justica Federal",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "civel",
    description: "Certidao Unificada dos 6 TRFs (Justica Federal)",
    // J.1 (Phase J): não emite PDF — retorna JSON agregado por TRF.
    emitsPdf: false,
    portalUrl: "https://www.trf3.jus.br/certidao/", // fallback para SP/MS
  },

  // --- Estadual SP ---
  "tribunal/trt2/ceat": {
    id: "tribunal/trt2/ceat",
    label: "CEAT TRT2 (SP - fisico)",
    costCents: 4,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao de Execucoes Trabalhistas do TRT2 (capital SP - autos fisicos)",
    portalUrl: "https://ww2.trt2.jus.br/servicos/certidoes",
  },
  "tribunal/trt2/ceat-digital": {
    id: "tribunal/trt2/ceat-digital",
    label: "CEAT TRT2 (SP - digital)",
    costCents: 4,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao de Execucoes Trabalhistas do TRT2 (capital SP - autos digitais)",
    portalUrl: "https://ww2.trt2.jus.br/servicos/certidoes",
  },
  "tribunal/trt15/ceat": {
    id: "tribunal/trt15/ceat",
    label: "CEAT TRT15 (SP interior)",
    costCents: 4,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao de Execucoes Trabalhistas do TRT15 (interior de SP)",
    portalUrl: "https://trt15.jus.br/servicos/certidoes",
  },
  "tribunal/tjsp/pedido-civel": {
    id: "tribunal/tjsp/pedido-civel",
    label: "TJSP Civel (pedido)",
    costCents: 6,
    twoStep: true,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Pedido de Certidao Civel do TJSP — 1o passo (5-15 min ate ficar pronta)",
    expectedWaitMinutes: 15,
    portalUrl: "https://esaj.tjsp.jus.br/esaj?servico=810000",
  },
  "tribunal/tjsp/obter-civel": {
    id: "tribunal/tjsp/obter-civel",
    label: "TJSP Civel (obter)",
    costCents: 4,
    initialStatus: "awaiting_portal",
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Obtencao da Certidao Civel do TJSP — 2o passo (automatico via cron)",
  },
  // Fluxo genérico multi-modelo (2026-05-23) — substitui o pedido-civel (que era
  // cível-only e ignorava tipo_certidao). `modelo` é numérico: 4 = Cível em Geral
  // (SAJ SGC, engloba cíveis+família+execuções fiscais), 1 = Falências/Concordatas/
  // Recuperações. Exige `rg` para PF. Ver memória certidoes_tjsp_pedido_civel_only.
  "tribunal/tjsp/pedido-certidao": {
    id: "tribunal/tjsp/pedido-certidao",
    label: "TJSP Certidão de Distribuição (pedido)",
    costCents: 6,
    twoStep: true,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "civel",
    description:
      "Cadastro de pedido de certidão de distribuição do TJSP (modelo selecionável) — 1o passo",
    expectedWaitMinutes: 15,
    portalUrl: "https://esaj.tjsp.jus.br/esaj?servico=810000",
  },
  "tribunal/tjsp/obter-certidao": {
    id: "tribunal/tjsp/obter-certidao",
    label: "TJSP Certidão de Distribuição (obter)",
    costCents: 4,
    initialStatus: "awaiting_portal",
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "civel",
    description:
      "Obtenção da certidão de distribuição do TJSP — 2o passo (automático via cron)",
  },
  // H.14 (Phase H, 2026-04-18) — placeholder para E-Proc SP 1ª/2ª instâncias.
  // Infosimples não emite; SkippedJob + externalLink abre portal oficial.
  // Entry no catálogo é necessária para CertidoesTab renderizar o card.
  // Legado: mantido só p/ resolver endpointInfo de jobs antigos (skip "sem
  // cobertura"). O planner agora dispara `tribunal/tjsp/eproc-lista` (abaixo).
  "tribunal/tjsp/eproc": {
    id: "tribunal/tjsp/eproc",
    label: "E-Proc SP (manual)",
    costCents: 0,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "civel",
    description: "E-Proc SP (legado) — substituído por tribunal/tjsp/eproc-lista.",
  },
  "tribunal/tjsp/eproc-lista": {
    id: "tribunal/tjsp/eproc-lista",
    label: "E-Proc SP (processos eletrônicos)",
    costCents: 6,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "civel",
    // Consulta informativa: retorna a lista dos processos eletrônicos (e-proc)
    // 1ª/2ª instância por CPF/CNPJ — NÃO emite PDF de certidão. Complementa a
    // certidão cível (pedido-civel).
    emitsPdf: false,
    portalUrl: "https://esaj.tjsp.jus.br/",
    description: "Lista de processos eletrônicos (e-proc) no TJSP por CPF/CNPJ — consulta informativa (1ª e 2ª instâncias).",
  },

  // --- Estadual RJ ---
  "tribunal/trt1/ceat": {
    id: "tribunal/trt1/ceat",
    label: "CEAT TRT1 (RJ)",
    costCents: 4,
    scope: "estadual",
    uf: "RJ",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao de Execucoes Trabalhistas do TRT1 (Rio de Janeiro)",
    portalUrl: "https://www.trt1.jus.br/certidoes",
  },
  "tribunal/tjrj/pedido-cert": {
    id: "tribunal/tjrj/pedido-cert",
    label: "TJRJ Civel (pedido)",
    costCents: 6,
    twoStep: true,
    scope: "estadual",
    uf: "RJ",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Pedido de Certidao Civel do TJRJ — 1o passo (ate 8 dias uteis)",
    expectedWaitMinutes: 8 * 24 * 60, // 8 dias úteis aproximado
    portalUrl: "https://www3.tjrj.jus.br/certidaoeletronica/",
  },
  "tribunal/tjrj/obter-certidao": {
    id: "tribunal/tjrj/obter-certidao",
    label: "TJRJ Civel (obter)",
    costCents: 4,
    initialStatus: "awaiting_portal",
    scope: "estadual",
    uf: "RJ",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Obtencao da Certidao Civel do TJRJ — 2o passo (automatico via cron)",
  },

  // --- Estadual RS ---
  "tribunal/trt4/ceat": {
    id: "tribunal/trt4/ceat",
    label: "CEAT TRT4 (RS)",
    costCents: 4,
    scope: "estadual",
    uf: "RS",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao de Execucoes Trabalhistas do TRT4 (Rio Grande do Sul)",
    portalUrl: "https://www.trt4.jus.br/portais/trt4/certidoes",
  },
  "tribunal/tjrs/primeiro-grau": {
    id: "tribunal/tjrs/primeiro-grau",
    label: "TJRS 1o grau",
    costCents: 4,
    scope: "estadual",
    uf: "RS",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Certidao Civel do TJRS — 1o grau (5 tipos: civel, familia, falencia, execucoes patrimoniais, execucoes fiscais)",
    portalUrl: "https://www.tjrs.jus.br/novo/servicos/certidoes/",
  },

  // --- Protesto SP ---
  "cenprot-sp/protestos": {
    id: "cenprot-sp/protestos",
    label: "CENPROT SP (Protestos)",
    costCents: 6,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa", "imovel"],
    category: "protesto",
    description: "Consulta de protestos no CENPROT SP",
    portalUrl: "https://www.pesquisaprotestosp.com.br",
  },

  // --- Municipal SP ---
  "pref/sp/sao-paulo/iptu": {
    id: "pref/sp/sao-paulo/iptu",
    label: "CND IPTU Sao Paulo",
    costCents: 4,
    scope: "municipal",
    uf: "SP",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidao Negativa de Debitos de IPTU da Prefeitura de Sao Paulo (exige SQL)",
    portalUrl: "https://prefeitura.sp.gov.br/web/fazenda/w/servicos/certidoes/2407",
  },
  "pref/sp/sao-paulo/debitos-iptu": {
    id: "pref/sp/sao-paulo/debitos-iptu",
    label: "Débitos IPTU São Paulo",
    costCents: 4,
    scope: "municipal",
    uf: "SP",
    appliesTo: ["imovel"],
    category: "municipal",
    emitsPdf: false,
    description: "Consulta de débitos de IPTU da Prefeitura de São Paulo por SQL — informativo (valores em aberto).",
    portalUrl: "https://prefeitura.sp.gov.br/web/fazenda",
  },
  "pref/sp/sao-paulo/dados-imovel": {
    id: "pref/sp/sao-paulo/dados-imovel",
    label: "Dados Cadastrais / Valor Venal SP",
    costCents: 4,
    scope: "municipal",
    uf: "SP",
    appliesTo: ["imovel"],
    category: "municipal",
    emitsPdf: false,
    description: "Dados cadastrais e valor venal do imóvel na Prefeitura de São Paulo (exige SQL) — informativo.",
    portalUrl: "https://prefeitura.sp.gov.br/web/fazenda",
  },

  // --- Municipal RJ ---
  "pref/rj/rio-janeiro/cert-trib": {
    id: "pref/rj/rio-janeiro/cert-trib",
    label: "Certidao Tributaria IPTU RJ",
    costCents: 4,
    scope: "municipal",
    uf: "RJ",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidao Tributaria de IPTU da Prefeitura do Rio de Janeiro (exige inscricao municipal)",
  },
  "pref/rj/rio-janeiro/cnd": {
    id: "pref/rj/rio-janeiro/cnd",
    label: "CND Municipal RJ",
    costCents: 4,
    scope: "municipal",
    uf: "RJ",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidao Negativa de Debitos Municipais do Rio de Janeiro (exige inscricao municipal)",
  },
  "pref/rj/rio-janeiro/iptu": {
    id: "pref/rj/rio-janeiro/iptu",
    label: "IPTU Rio de Janeiro (dados/guia)",
    costCents: 4,
    scope: "municipal",
    uf: "RJ",
    appliesTo: ["imovel"],
    category: "municipal",
    emitsPdf: false,
    description: "Consulta de IPTU da Prefeitura do Rio de Janeiro por inscrição municipal — informativo (dados/guia).",
  },

  // --- Municipal — demais capitais cobertas (Phase L, 2026-05-22) ---
  // Belo Horizonte
  "pref/mg/belo-horizonte/cndiptu": {
    id: "pref/mg/belo-horizonte/cndiptu",
    label: "CND IPTU Belo Horizonte",
    costCents: 8,
    scope: "municipal",
    uf: "MG",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidão Negativa de Débitos de IPTU da Prefeitura de Belo Horizonte (exige índice cadastral).",
    portalUrl: "https://prefeitura.pbh.gov.br/fazenda",
  },
  "pref/mg/belo-horizonte/cnd": {
    id: "pref/mg/belo-horizonte/cnd",
    label: "CND Municipal Belo Horizonte",
    costCents: 8,
    scope: "municipal",
    uf: "MG",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidão Negativa de Débitos Municipais da Prefeitura de Belo Horizonte.",
    portalUrl: "https://prefeitura.pbh.gov.br/fazenda",
  },
  // Porto Alegre — fecha o gap histórico de IPTU POA
  "pref/rs/porto-alegre/cnd": {
    id: "pref/rs/porto-alegre/cnd",
    label: "CND Municipal Porto Alegre",
    costCents: 4,
    scope: "municipal",
    uf: "RS",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidão Negativa de Débitos Municipais (inclui IPTU) da Prefeitura de Porto Alegre.",
    portalUrl: "https://prefeitura.poa.br/smf/iptu",
  },
  // Curitiba
  "pref/pr/curitiba/cnd": {
    id: "pref/pr/curitiba/cnd",
    label: "CND Municipal Curitiba",
    costCents: 8,
    scope: "municipal",
    uf: "PR",
    // CND de Curitiba é POR CONTRIBUINTE (cpf/cnpj), não por imóvel (doc
    // pública 2026-05-22) → appliesTo pessoa. Auto-dispara na trilha de pessoa
    // p/ partes de Curitiba (MUNICIPAL_PESSOA_BY_KEY no planner).
    appliesTo: ["pessoa"],
    category: "municipal",
    description: "Certidão Negativa de Débitos Municipais de Curitiba — emitida por contribuinte (CPF/CNPJ), não por imóvel.",
    portalUrl: "https://www.curitiba.pr.gov.br/",
  },
  // Florianópolis
  "pref/sc/florianopolis/cnd": {
    id: "pref/sc/florianopolis/cnd",
    label: "CND Municipal Florianópolis",
    costCents: 4,
    scope: "municipal",
    uf: "SC",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidão Negativa de Débitos Municipais (inclui IPTU) da Prefeitura de Florianópolis.",
    portalUrl: "https://www.pmf.sc.gov.br/",
  },
  // Cuiabá
  "pref/mt/cuiaba/cnd": {
    id: "pref/mt/cuiaba/cnd",
    label: "CND Municipal Cuiabá",
    costCents: 4,
    scope: "municipal",
    uf: "MT",
    appliesTo: ["imovel"],
    category: "municipal",
    description: "Certidão Negativa de Débitos Municipais (inclui IPTU) da Prefeitura de Cuiabá.",
    portalUrl: "https://cuiaba.mt.gov.br/",
  },

  // ============================================================
  // Phase B — Expansão Regional (abril/2026)
  // Fontes: research-notes.md + infosimples.com/consultas/precos/
  // ============================================================

  // --- Cíveis estaduais adicionais (1 etapa, exceto TJMS) ---
  "tribunal/tjba/primeiro-grau": {
    id: "tribunal/tjba/primeiro-grau",
    label: "Certidao Civel TJBA",
    costCents: 4,
    scope: "estadual",
    uf: "BA",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Certidao de 1o Grau do TJBA (Bahia) — 1 etapa",
  },
  "tribunal/tjgo/nada-consta": {
    id: "tribunal/tjgo/nada-consta",
    label: "Nada Consta TJGO",
    costCents: 4,
    scope: "estadual",
    uf: "GO",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Certidao Nada Consta do TJGO (Goias) — 1o e 2o grau",
  },
  "tribunal/tjdf/nada-consta": {
    id: "tribunal/tjdf/nada-consta",
    label: "Nada Consta TJDF",
    costCents: 4,
    scope: "estadual",
    uf: "DF",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Certidao Nada Consta do TJDF (Distrito Federal)",
  },
  "tribunal/tjsc/pedido-certidao": {
    id: "tribunal/tjsc/pedido-certidao",
    label: "Certidao TJSC (pedido)",
    costCents: 6,
    scope: "estadual",
    uf: "SC",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Certidao do TJSC (Santa Catarina) — prazo ate 5 dias uteis",
  },
  "tribunal/tjms/pedido-cert": {
    id: "tribunal/tjms/pedido-cert",
    label: "Certidao TJMS (pedido)",
    costCents: 6,
    twoStep: true,
    scope: "estadual",
    uf: "MS",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Pedido de Certidao do TJMS (Mato Grosso do Sul) — 1o passo",
  },
  "tribunal/tjms/obter-certidao": {
    id: "tribunal/tjms/obter-certidao",
    label: "Certidao TJMS (obter)",
    costCents: 4,
    initialStatus: "awaiting_portal",
    scope: "estadual",
    uf: "MS",
    appliesTo: ["pessoa", "imovel"],
    category: "civel",
    description: "Obtencao da Certidao do TJMS — 2o passo (automatico via cron)",
  },
  "tribunal/tjmt/primeiro-grau-pf": {
    id: "tribunal/tjmt/primeiro-grau-pf",
    label: "Certidao Civel TJMT (PF)",
    costCents: 4,
    scope: "estadual",
    uf: "MT",
    appliesTo: ["pessoa"],
    category: "civel",
    description: "Certidao de 1o Grau do TJMT (Mato Grosso) — pessoa fisica apenas",
  },

  // --- Trabalhistas (CEAT regional, R$ 0,04 cada) ---
  "tribunal/trt3/ceat": {
    id: "tribunal/trt3/ceat",
    label: "CEAT TRT3 (MG)",
    costCents: 4,
    scope: "estadual",
    uf: "MG",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Eletronica de Acoes Trabalhistas do TRT3 (Minas Gerais)",
  },
  "tribunal/trt5/ceat": {
    id: "tribunal/trt5/ceat",
    label: "CEAT TRT5 (BA)",
    costCents: 4,
    scope: "estadual",
    uf: "BA",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Eletronica de Acoes Trabalhistas do TRT5 (Bahia)",
  },
  "tribunal/trt9/ceat": {
    id: "tribunal/trt9/ceat",
    label: "CEAT TRT9 (PR)",
    costCents: 4,
    scope: "estadual",
    uf: "PR",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Eletronica de Acoes Trabalhistas do TRT9 (Parana)",
  },
  "tribunal/trt10/ceat": {
    id: "tribunal/trt10/ceat",
    label: "CEAT TRT10 (DF/TO)",
    costCents: 4,
    scope: "estadual",
    uf: "DF",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Eletronica de Acoes Trabalhistas do TRT10 (DF + Tocantins) — autos fisicos",
  },
  "tribunal/trt10/ceat-digital": {
    id: "tribunal/trt10/ceat-digital",
    label: "CEAT TRT10 digital",
    costCents: 4,
    scope: "estadual",
    uf: "DF",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Eletronica de Acoes Trabalhistas do TRT10 — autos digitais",
  },
  "tribunal/trt12/ceat": {
    id: "tribunal/trt12/ceat",
    label: "CEAT TRT12 (SC)",
    costCents: 4,
    scope: "estadual",
    uf: "SC",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Eletronica de Acoes Trabalhistas do TRT12 (Santa Catarina)",
  },

  // --- PJ federal: cartao CNPJ + CRF FGTS ---
  "receita-federal/cnpj": {
    id: "receita-federal/cnpj",
    label: "Cartao CNPJ",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "cadastro",
    description: "Consulta cadastral da Receita Federal — situacao, CNAE, QSA, endereco (PJ)",
  },
  "caixa/regularidade": {
    id: "caixa/regularidade",
    label: "CRF FGTS",
    costCents: 6,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "fgts",
    description: "Certificado de Regularidade do FGTS emitido pela Caixa (PJ)",
    portalUrl: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf",
  },

  // --- Phase K (2026-04-18) — Gaps do Mapeamento_Certidoes.md ---
  // K.2 (Phase K): endpoints Infosimples que cobrem itens obrigatórios do
  // Mapeamento ainda não implementados.
  "receita-federal/cpf": {
    id: "receita-federal/cpf",
    label: "Situação CPF (Receita Federal)",
    costCents: 2,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "cadastro",
    description:
      "Consulta cadastral do CPF na Receita Federal (regular/suspensa/pendente/cancelada/nula). Filtro inicial obrigatório — CPF irregular invalida a operação.",
    emitsPdf: false, // informativo — retorna status textual
    portalUrl: "https://servicos.receitafederal.gov.br/servico/cpf",
  },
  "antecedentes-criminais/pf/emit": {
    id: "antecedentes-criminais/pf/emit",
    label: "Antecedentes Criminais (PF)",
    costCents: 6,
    // NÃO é two-step: o `emit` a 200 já devolve o resultado (nada_consta/
    // resultado/data_emissao + PDF em site_receipts) — o extractor lê direto
    // (normalizers.ts antecedentesPfExtractor). Marcar twoStep fazia o 200 cair
    // no fluxo de pedido (espera `numero_pedido`, que o emit NÃO retorna) →
    // pollPortalJob morria em status:"failed". O `val` é só validação de código,
    // dispensável para obter a certidão. (fix 2026-06-02)
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "civel",
    description:
      "Certidão de Antecedentes Criminais emitida pela Polícia Federal. Facultativa em transações particulares; obrigatória em financiamento bancário.",
    expectedWaitMinutes: 5, // instantâneo na maioria dos casos
    portalUrl: "https://www.gov.br/pf/pt-br/assuntos/antecedentes-criminais",
  },
  "antecedentes-criminais/pf/val": {
    id: "antecedentes-criminais/pf/val",
    label: "Antecedentes Criminais (PF) — Validar",
    costCents: 2,
    initialStatus: "awaiting_portal",
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "civel",
    description: "Validação do código emitido pelo 1º passo (PF antecedentes).",
    portalUrl: "https://www.gov.br/pf/pt-br/assuntos/antecedentes-criminais",
  },
  "sncr/ccir": {
    id: "sncr/ccir",
    label: "CCIR (Imóvel Rural)",
    costCents: 4,
    scope: "federal",
    appliesTo: ["imovel"],
    category: "federal",
    description:
      "Certificado de Cadastro de Imóvel Rural — INCRA/SNCR. Obrigatório apenas para imóveis rurais.",
    portalUrl: "https://sncr.serpro.gov.br/sncr-web/public/buscaPublica.jsf",
  },
  // ONR/ARISP — Matrícula (Visualização de Inteiro Teor). Two-step real:
  // `registradores/matric/pedido` (1º passo) → `registradores/matric/download`
  // (2º passo, busca o PDF da matrícula já gerada). Usa SALDO do portal ONR e
  // credenciais próprias (requiresOnrAuth).
  // SLUGS (2026-05-25): a API v2 usa BARRA no caminho (`matric/pedido`), não
  // hífen. Probe ao vivo: `registradores/matric-pedido` → 602 ("serviço não é
  // válido"); `registradores/matric/pedido` → 606 (válido, só faltam params).
  // O hífen quebrou a trilha ONR desde sempre — corrigido para barra.
  "registradores/matric/pedido": {
    id: "registradores/matric/pedido",
    label: "Matrícula ONR (pedido)",
    costCents: 10,
    twoStep: true,
    scope: "federal",
    appliesTo: ["imovel"],
    category: "registro",
    requiresOnrAuth: true,
    description:
      "Pedido de Visualização de Inteiro Teor da Matrícula via ONR/ARISP (Registradores) — 1º passo. Debita o saldo do portal ONR (imediato a 5 dias úteis).",
    expectedWaitMinutes: 5 * 24 * 60, // 5 dias úteis
    portalUrl: "https://www.registradores.org.br/",
  },
  "registradores/matric/download": {
    id: "registradores/matric/download",
    label: "Matrícula ONR (download)",
    costCents: 4,
    initialStatus: "awaiting_portal",
    scope: "federal",
    appliesTo: ["imovel"],
    category: "registro",
    requiresOnrAuth: true,
    description:
      "Download da Matrícula (inteiro teor) já gerada no portal ONR/ARISP — 2º passo (automático via cron).",
    portalUrl: "https://www.registradores.org.br/",
  },
  // Lista de pedidos de matrícula já gerados na conta ONR — NÃO consome saldo
  // do portal. Útil para reconciliar pedidos e localizar PDFs avulsos.
  "registradores/matric/lista": {
    id: "registradores/matric/lista",
    label: "Matrícula ONR (lista de pedidos)",
    costCents: 4,
    scope: "federal",
    appliesTo: ["imovel"],
    category: "registro",
    requiresOnrAuth: true,
    emitsPdf: false,
    description:
      "Lista de pedidos de matrícula já gerados na conta ONR/ARISP — consulta informativa, não consome saldo do portal.",
    portalUrl: "https://www.registradores.org.br/",
  },
  // ONR Mapa do Registro de Imóveis — pesquisa de bens NACIONAL por CPF/CNPJ
  // (diligência patrimonial / KYC). Substitui o `registradores-previa-bens`
  // (descontinuado e SP-only). Informativo: retorna lista de imóveis (cartório,
  // matrícula, última atualização), sem certidão/PDF.
  "onr/mapa-registro-imoveis": {
    id: "onr/mapa-registro-imoveis",
    label: "ONR — Pesquisa de Bens (Mapa do Registro)",
    costCents: 6,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "registro",
    requiresOnrAuth: true,
    emitsPdf: false,
    description:
      "Pesquisa nacional de imóveis em nome de CPF/CNPJ no Mapa do Registro de Imóveis (ONR). Diligência patrimonial — retorna cartório, matrícula e data da última atualização. Debita saldo do portal ONR.",
    portalUrl: "https://www.registradores.org.br/",
  },

  // --- Divida Ativa estadual unificada (27 UFs) ---
  "sefaz/certidao-debitos": {
    id: "sefaz/certidao-debitos",
    label: "CND Estadual Sefaz",
    // Variavel por UF (4-10 centavos tipicamente). 6 e o valor medio.
    costCents: 6,
    scope: "estadual",
    appliesTo: ["pessoa"],
    category: "fiscal",
    description: "Certidao Negativa de Debitos Estaduais unificada (todas as 27 UFs) — exige UF no request",
    portalUrl: "https://www4.fazenda.sp.gov.br/CertidaoNegativaDebitos",
  },
  "pge-sp/cndt": {
    id: "pge-sp/cndt",
    label: "CND PGE-SP",
    costCents: 4,
    scope: "estadual",
    uf: "SP",
    appliesTo: ["pessoa"],
    category: "fiscal",
    description: "Certidao Negativa da Divida Ativa do Estado de Sao Paulo (PGE-SP)",
    portalUrl: "https://www.dividaativa.pge.sp.gov.br/sc/pages/certidao/consultar.jsf",
  },

  // ============================================================
  // Phase F.II-γ — Cobertura oficial expandida (abril/2026)
  // ============================================================

  // --- TRF individuais (cível + criminal, cobrem 1ª e 2ª instância) ---
  "tribunal/trf1/certidao": {
    id: "tribunal/trf1/certidao",
    label: "Certidao Civel+Criminal TRF1",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Certidao Negativa Civel e Criminal do TRF1 (AC/AM/AP/BA/DF/GO/MA/MT/PA/PI/RO/RR/TO)",
    portalUrl: "https://www.trf1.jus.br/Servicos/Certidao/",
  },
  "tribunal/trf2/certidao": {
    id: "tribunal/trf2/certidao",
    label: "Certidao Civel+Criminal TRF2",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Certidao Negativa Civel e Criminal do TRF2 (RJ/ES)",
    portalUrl: "https://www10.trf2.jus.br/portal/certidao-eletronica/",
  },
  "tribunal/trf3/certidao-distr": {
    id: "tribunal/trf3/certidao-distr",
    label: "Certidao TRF3 (pedido)",
    costCents: 4,
    twoStep: true,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Pedido de Certidao de Distribuicao TRF3 (SP/MS) — 1o passo. TRF3 e o unico TRF com fluxo 2-step.",
    expectedWaitMinutes: 15,
    portalUrl: "https://www.trf3.jus.br/certidao/",
  },
  "tribunal/trf3/obter-certidao": {
    id: "tribunal/trf3/obter-certidao",
    label: "Certidao TRF3 (obter)",
    costCents: 4,
    initialStatus: "awaiting_portal",
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Obtencao da Certidao de Distribuicao TRF3 — 2o passo (automatico via cron).",
    portalUrl: "https://www.trf3.jus.br/certidao/",
  },
  "tribunal/trf4/certidao": {
    id: "tribunal/trf4/certidao",
    label: "Certidao Civel+Criminal TRF4",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Certidao Negativa Civel e Criminal do TRF4 (RS/SC/PR)",
    portalUrl: "https://www2.trf4.jus.br/trf4/controlador.php?acao=certidao_inicial",
  },
  "tribunal/trf5/certidao": {
    id: "tribunal/trf5/certidao",
    label: "Certidao Civel+Criminal TRF5",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Certidao Negativa Civel e Criminal do TRF5 (AL/CE/PB/PE/RN/SE)",
    portalUrl: "https://www.trf5.jus.br/certidao",
  },
  "tribunal/trf6/certidao": {
    id: "tribunal/trf6/certidao",
    label: "Certidao Civel+Criminal TRF6",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "federal",
    description: "Certidao Negativa Civel e Criminal do TRF6 (MG)",
    portalUrl: "https://portal.trf6.jus.br/certidoes",
  },

  // --- CENPROT Nacional (exige login GOV.BR configurado na conta Infosimples) ---
  "ieptb/protestos": {
    id: "ieptb/protestos",
    label: "CENPROT Nacional (Protestos)",
    costCents: 6,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "protesto",
    requiresGovBrAuth: true,
    description:
      "Consulta nacional de protestos (IEPTB/CENPROT) para PF e PJ em todas as UFs. Os detalhes dos cartorios de SP sao obtidos automaticamente via ieptb/protestos-detalhes-sp. Requer sessao GOV.BR ativa na conta Infosimples.",
  },
  // Follow-up síncrono do nacional: detalhes dos cartórios SP via campo
  // `obter_detalhes` da resposta de `ieptb/protestos`. Encadeado pelo
  // executor (runSingleJob), nunca emitido pelo planner nem exibido no picker.
  "ieptb/protestos-detalhes-sp": {
    id: "ieptb/protestos-detalhes-sp",
    label: "CENPROT Nacional — Detalhes SP",
    costCents: 6,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "protesto",
    requiresGovBrAuth: true,
    internalOnly: true,
    description:
      "Detalhes dos cartorios de SP obtidos via campo obter_detalhes da consulta nacional IEPTB. Disparado automaticamente como follow-up de ieptb/protestos.",
  },

  // --- Serasa Experian ---
  // Diferente da Infosimples, o Serasa devolve JSON estruturado. O executor
  // gera PDF próprio (Puppeteer) a partir do normalized result e anexa como
  // DealAttachment source="serasa". Custos placeholder (R$ 5) até pricing
  // comercial fechar — NÃO mexer em prod sem ajustar.
  "serasa/score-pf": {
    id: "serasa/score-pf",
    label: "Serasa — Score PF",
    costCents: 500,
    scope: "serasa",
    appliesTo: ["pessoa"],
    category: "score",
    provider: "serasa",
    emitsPdf: false,
    description: "Score de credito (0-1000) e drivers de risco para pessoa fisica via Serasa Experian.",
  },
  "serasa/score-pj": {
    id: "serasa/score-pj",
    label: "Serasa — Score PJ",
    costCents: 500,
    scope: "serasa",
    appliesTo: ["pessoa"],
    category: "score",
    provider: "serasa",
    emitsPdf: false,
    description: "Score de credito empresarial (0-1000) via Serasa Experian.",
  },
  "serasa/restritivos-pf": {
    id: "serasa/restritivos-pf",
    label: "Serasa — Negativacao PF",
    costCents: 500,
    scope: "serasa",
    appliesTo: ["pessoa"],
    category: "negativacao",
    provider: "serasa",
    emitsPdf: false,
    description: "Pendencias financeiras (Pefin/Refin), protestos e acoes para pessoa fisica.",
  },
  "serasa/restritivos-pj": {
    id: "serasa/restritivos-pj",
    label: "Serasa — Negativacao PJ",
    costCents: 500,
    scope: "serasa",
    appliesTo: ["pessoa"],
    category: "negativacao",
    provider: "serasa",
    emitsPdf: false,
    description: "Pendencias financeiras, protestos e acoes para pessoa juridica.",
  },
  "serasa/vinculos-pj-pf": {
    id: "serasa/vinculos-pj-pf",
    label: "Serasa — Vinculos PJ↔PF",
    costCents: 500,
    scope: "serasa",
    appliesTo: ["pessoa"],
    category: "vinculos",
    provider: "serasa",
    emitsPdf: false,
    description: "Lista de CNPJs onde o CPF aparece como socio, administrador ou representante. Usado para diligenciar PJ ocultas.",
  },
};

export function endpointInfo(id: string): EndpointInfo {
  return (
    ENDPOINTS[id] ?? {
      id,
      label: id,
      costCents: 4,
      scope: "federal",
      appliesTo: ["pessoa"],
      category: "federal",
    }
  );
}

/**
 * TJRS granular civil certificate types — each is a separate request.
 * Source: planner uses these to build per-type jobs.
 */
export const TJRS_TIPOS: Array<{ tipo: number; label: string }> = [
  { tipo: 3, label: "Civel Negativa 1o grau" },
  { tipo: 4, label: "Familia e Sucessoes" },
  { tipo: 7, label: "Falencia" },
  { tipo: 8, label: "Execucoes Patrimoniais" },
  { tipo: 9, label: "Execucoes Fiscais" },
];
