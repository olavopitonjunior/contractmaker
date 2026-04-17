/**
 * Catalog of Infosimples endpoints used by Contractmaker.
 * Cost in cents of R$ (4 = R$ 0,04). Used for budget estimates + reporting.
 *
 * F1 metadata: each endpoint is tagged with scope/uf/category/appliesTo so the
 * planner can filter endpoints declaratively (no hardcoded switch) and the
 * picker UI can group them by scope and filter by UF.
 */

export type EndpointScope = "federal" | "estadual" | "municipal";
export type EndpointCategory =
  | "civel"
  | "trabalhista"
  | "fiscal"
  | "protesto"
  | "municipal"
  | "federal"
  | "cadastro"    // Phase B: Cartão CNPJ, CPF situation — informational dumps
  | "fgts";        // Phase B: CRF FGTS (Caixa) — labor-adjacent regulatory
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
  /** F1: tooltip shown in the picker */
  description?: string;
}

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
  },
  "tribunal/tst/cndt": {
    id: "tribunal/tst/cndt",
    label: "CNDT (Trabalhista)",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "trabalhista",
    description: "Certidao Negativa de Debitos Trabalhistas (TST, nacional)",
  },
  "tribunal/trf/cert-unificada": {
    id: "tribunal/trf/cert-unificada",
    label: "Certidao Civel Justica Federal",
    costCents: 4,
    scope: "federal",
    appliesTo: ["pessoa"],
    category: "civel",
    description: "Certidao Unificada dos 6 TRFs (Justica Federal)",
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
