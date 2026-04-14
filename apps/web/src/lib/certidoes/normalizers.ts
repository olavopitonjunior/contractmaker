import type { InfosimplesResponse, NormalizedResult, Situacao } from "./types";

/**
 * Generic normalizer. Each endpoint has its own data shape, but most return
 * something with one of these well-known fields:
 *   - consta_debito / consta_debitos (boolean)
 *   - tipo_certidao / tipo ("negativa" | "positiva" | "positiva com efeitos")
 *   - conseguiu_emitir_certidao_negativa (boolean)
 *   - validade / data_validade
 *   - emissao / data_emissao
 * We map each known endpoint to a tailored extractor and fall back to a
 * heuristic parser for the rest.
 */

type Extractor = (resp: InfosimplesResponse) => NormalizedResult;

function getFirst<T = unknown>(resp: InfosimplesResponse): T | undefined {
  return resp.data?.[0] as T | undefined;
}

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v).trim() || undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (["sim", "true", "1", "yes"].includes(s)) return true;
    if (["nao", "não", "false", "0", "no"].includes(s)) return false;
  }
  return undefined;
}

function detectSituacao(text: string | undefined): Situacao {
  if (!text) return "indeterminado";
  const t = text.toLowerCase();
  if (t.includes("positiva com efeitos") || t.includes("positiva com efeito"))
    return "positiva_com_efeitos";
  if (t.includes("negativa") || t.includes("nada consta")) return "negativa";
  if (t.includes("positiva")) return "positiva";
  if (t.includes("nao foi possivel") || t.includes("não foi possível"))
    return "nao_emitida";
  return "indeterminado";
}

function pgfnExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const tipo = asString(d.tipo_certidao) || asString(d.tipo);
  const situacao = detectSituacao(tipo);
  return {
    situacao,
    validade: asString(d.data_validade ?? d.validade) ?? null,
    emissao: asString(d.data_emissao ?? d.emissao) ?? null,
    detalhes: tipo ?? null,
    consta_debito: situacao === "positiva" || situacao === "positiva_com_efeitos",
    raw: d,
  };
}

function cndtExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const conseguiu = asBool(d.conseguiu_emitir_certidao_negativa);
  const consta = asBool(d.consta);
  const situacao: Situacao =
    conseguiu === false
      ? "nao_emitida"
      : consta === true
      ? "positiva"
      : "negativa";
  return {
    situacao,
    validade: asString(d.data_validade) ?? null,
    emissao: asString(d.data_emissao) ?? null,
    detalhes: asString(d.mensagem) ?? null,
    consta_debito: consta === true,
    raw: d,
  };
}

function trfUnificadaExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const trfs = ["trf1", "trf2", "trf3", "trf4", "trf5", "trf6"] as const;
  const perTrf = trfs.map((key) => {
    const t = (d[key] as Record<string, unknown>) ?? {};
    return {
      trf: key,
      conseguiu: asBool(t.conseguiu_emitir_certidao_negativa),
      mensagem: asString(t.mensagem) ?? null,
    };
  });
  const allOk = perTrf.every((t) => t.conseguiu === true);
  const anyFail = perTrf.some((t) => t.conseguiu === false);
  const situacao: Situacao = allOk
    ? "negativa"
    : anyFail
    ? "nao_emitida"
    : "indeterminado";
  return {
    situacao,
    validade: asString(d.data_validade) ?? null,
    emissao: asString(d.data_emissao) ?? null,
    detalhes: perTrf
      .filter((t) => t.conseguiu === false)
      .map((t) => `${t.trf.toUpperCase()}: ${t.mensagem ?? "falhou"}`)
      .join("; ") || "Certidao negativa nos 6 TRFs",
    consta_debito: false,
    raw: d,
  };
}

function ceatExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const consta = asBool(d.consta) ?? asBool(d.consta_processos);
  const tipo = asString(d.tipo) ?? asString(d.tipo_certidao);
  const situacao = consta === true ? "positiva" : detectSituacao(tipo);
  return {
    situacao: situacao === "indeterminado" ? "negativa" : situacao,
    validade: asString(d.data_validade ?? d.validade) ?? null,
    emissao: asString(d.data_emissao ?? d.emissao) ?? null,
    detalhes: tipo ?? asString(d.mensagem) ?? null,
    consta_debito: consta === true,
    raw: d,
  };
}

function tjExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const tipo = asString(d.tipo_certidao) ?? asString(d.resultado);
  const situacao = detectSituacao(tipo);
  const numeroPedido = asString(d.numero_pedido ?? d.numero_requerimento);
  return {
    situacao,
    validade: asString(d.data_validade) ?? null,
    emissao: asString(d.data_emissao) ?? null,
    detalhes: [tipo, numeroPedido ? `pedido ${numeroPedido}` : null]
      .filter(Boolean)
      .join(" — ") || null,
    consta_debito: situacao === "positiva" || situacao === "positiva_com_efeitos",
    raw: d,
  };
}

function cenprotSpExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const protestos = d.protestos;
  const consta = Array.isArray(protestos) && protestos.length > 0;
  return {
    situacao: consta ? "positiva" : "negativa",
    validade: null,
    emissao: asString(d.data_consulta) ?? null,
    detalhes: consta
      ? `${(protestos as unknown[]).length} protesto(s) encontrado(s)`
      : "Nada consta",
    consta_debito: consta,
    raw: d,
  };
}

function iptuExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const consta = asBool(d.consta_debito) ?? asBool(d.tem_debito);
  const tipo = asString(d.tipo_certidao) ?? asString(d.situacao);
  const situacao = consta === true ? "positiva" : detectSituacao(tipo);
  return {
    situacao: situacao === "indeterminado" ? "negativa" : situacao,
    validade: asString(d.data_validade) ?? null,
    emissao: asString(d.data_emissao) ?? null,
    detalhes: asString(d.debitos_descricao) ?? tipo ?? null,
    consta_debito: consta === true,
    raw: d,
  };
}

const EXTRACTORS: Record<string, Extractor> = {
  "receita-federal/pgfn": pgfnExtractor,
  "tribunal/tst/cndt": cndtExtractor,
  "tribunal/trf/cert-unificada": trfUnificadaExtractor,
  "tribunal/trt2/ceat": ceatExtractor,
  "tribunal/trt2/ceat-digital": ceatExtractor,
  "tribunal/trt15/ceat": ceatExtractor,
  "tribunal/trt1/ceat": ceatExtractor,
  "tribunal/trt4/ceat": ceatExtractor,
  "tribunal/tjsp/pedido-civel": tjExtractor,
  "tribunal/tjsp/obter-civel": tjExtractor,
  "tribunal/tjrj/pedido-cert": tjExtractor,
  "tribunal/tjrj/obter-certidao": tjExtractor,
  "tribunal/tjrs/primeiro-grau": tjExtractor,
  "cenprot-sp/protestos": cenprotSpExtractor,
  "pref/sp/sao-paulo/iptu": iptuExtractor,
  "pref/rj/rio-janeiro/cert-trib": iptuExtractor,
  "pref/rj/rio-janeiro/cnd": iptuExtractor,
};

export function normalize(
  endpoint: string,
  resp: InfosimplesResponse
): NormalizedResult {
  if (resp.code !== 200) {
    return {
      situacao: resp.code >= 600 && resp.code < 700 ? "nao_emitida" : "indeterminado",
      validade: null,
      emissao: null,
      detalhes: resp.code_message || null,
      consta_debito: false,
      raw: resp,
    };
  }
  const fn = EXTRACTORS[endpoint];
  if (!fn) {
    const d = getFirst<Record<string, unknown>>(resp) ?? {};
    const tipo = asString((d as any).tipo_certidao) ?? asString((d as any).tipo);
    return {
      situacao: detectSituacao(tipo),
      validade: asString((d as any).data_validade) ?? null,
      emissao: asString((d as any).data_emissao) ?? null,
      detalhes: tipo ?? null,
      consta_debito: false,
      raw: d,
    };
  }
  return fn(resp);
}
