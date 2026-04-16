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
  | "federal";
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
