/**
 * Catalog of Infosimples endpoints used by Contractmaker.
 * Cost in cents of R$ (4 = R$ 0,04). Used for budget estimates + reporting.
 */
export interface EndpointInfo {
  id: string;
  label: string;
  costCents: number;
  twoStep?: boolean;
  initialStatus?: "pending" | "awaiting_portal";
}

export const ENDPOINTS: Record<string, EndpointInfo> = {
  "receita-federal/pgfn": { id: "receita-federal/pgfn", label: "CND Federal + Divida Ativa", costCents: 4 },
  "tribunal/tst/cndt": { id: "tribunal/tst/cndt", label: "CNDT (Trabalhista)", costCents: 4 },
  "tribunal/trf/cert-unificada": { id: "tribunal/trf/cert-unificada", label: "Certidao Civel Justica Federal", costCents: 4 },

  "tribunal/trt2/ceat": { id: "tribunal/trt2/ceat", label: "CEAT TRT2 (SP - fisico)", costCents: 4 },
  "tribunal/trt2/ceat-digital": { id: "tribunal/trt2/ceat-digital", label: "CEAT TRT2 (SP - digital)", costCents: 4 },
  "tribunal/trt15/ceat": { id: "tribunal/trt15/ceat", label: "CEAT TRT15 (SP interior)", costCents: 4 },
  "tribunal/trt1/ceat": { id: "tribunal/trt1/ceat", label: "CEAT TRT1 (RJ)", costCents: 4 },
  "tribunal/trt4/ceat": { id: "tribunal/trt4/ceat", label: "CEAT TRT4 (RS)", costCents: 4 },

  "tribunal/tjsp/pedido-civel": {
    id: "tribunal/tjsp/pedido-civel",
    label: "TJSP Civel (pedido)",
    costCents: 6,
    twoStep: true,
  },
  "tribunal/tjsp/obter-civel": {
    id: "tribunal/tjsp/obter-civel",
    label: "TJSP Civel (obter)",
    costCents: 4,
    initialStatus: "awaiting_portal",
  },
  "tribunal/tjrj/pedido-cert": {
    id: "tribunal/tjrj/pedido-cert",
    label: "TJRJ Civel (pedido)",
    costCents: 6,
    twoStep: true,
  },
  "tribunal/tjrj/obter-certidao": {
    id: "tribunal/tjrj/obter-certidao",
    label: "TJRJ Civel (obter)",
    costCents: 4,
    initialStatus: "awaiting_portal",
  },
  "tribunal/tjrs/primeiro-grau": { id: "tribunal/tjrs/primeiro-grau", label: "TJRS 1o grau", costCents: 4 },

  "cenprot-sp/protestos": { id: "cenprot-sp/protestos", label: "CENPROT SP (Protestos)", costCents: 6 },

  "pref/sp/sao-paulo/iptu": { id: "pref/sp/sao-paulo/iptu", label: "CND IPTU Sao Paulo", costCents: 4 },
  "pref/rj/rio-janeiro/cert-trib": { id: "pref/rj/rio-janeiro/cert-trib", label: "Certidao Tributaria IPTU RJ", costCents: 4 },
  "pref/rj/rio-janeiro/cnd": { id: "pref/rj/rio-janeiro/cnd", label: "CND Municipal RJ", costCents: 4 },
};

export function endpointInfo(id: string): EndpointInfo {
  return (
    ENDPOINTS[id] ?? {
      id,
      label: id,
      costCents: 4,
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
