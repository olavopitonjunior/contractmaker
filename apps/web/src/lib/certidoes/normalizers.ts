import type { InfosimplesResponse, NormalizedResult, Situacao } from "./types";
import {
  mapInfosimplesCodeToCategory,
  isProtestoNadaConsta,
} from "./error-codes";

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
  // H.2 (Phase H, 2026-04-18) — cascade resolution:
  // Payload real da Infosimples traz `raw.certidao` como string descritiva
  // ("CERTIDÃO NEGATIVA DE DÉBITOS...") + flags booleanas `debitos_rfb` e
  // `debitos_pgfn`. O campo `tipo_certidao`/`tipo` vem null em respostas
  // recentes. Antes, extractor só lia tipo_certidao → virava "indeterminado".
  const debitosRfb = asBool(d.debitos_rfb);
  const debitosPgfn = asBool(d.debitos_pgfn);
  const tipo = asString(d.tipo_certidao) || asString(d.tipo);
  const certidaoTxt = asString(d.certidao) || asString(d.mensagem);

  let situacao: Situacao;
  if (debitosRfb === false && debitosPgfn === false) {
    situacao = "negativa";
  } else if (debitosRfb === true || debitosPgfn === true) {
    situacao = "positiva";
  } else if (certidaoTxt) {
    situacao = detectSituacao(certidaoTxt);
  } else {
    situacao = detectSituacao(tipo);
  }
  return {
    situacao,
    validade: asString(d.data_validade ?? d.validade) ?? null,
    emissao: asString(d.data_emissao ?? d.emissao) ?? null,
    detalhes: tipo ?? certidaoTxt ?? null,
    consta_debito:
      situacao === "positiva" || situacao === "positiva_com_efeitos",
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
    validade:
      asString(d.normalizado_validade) ??
      asString(d.validade) ??
      asString(d.data_validade) ??
      null,
    emissao:
      asString(d.emissao_data) ??
      asString(d.expedicao) ??
      asString(d.data_emissao) ??
      null,
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
      emitiuPdf: asBool(t.emitiu_pdf),
      mensagem: asString(t.mensagem) ?? null,
    };
  });
  const allOk = perTrf.every((t) => t.conseguiu === true);
  const anyFail = perTrf.some((t) => t.conseguiu === false);
  const allNull = perTrf.every((t) => t.conseguiu == null);
  // "Aguardando PDF": at least one TRF returned conseguiu=true but emitiu_pdf=false.
  // This is a temporary state where Infosimples confirmed the negativa but the
  // portal is still preparing the PDF. Surface as a dedicated state instead of
  // "indeterminado" so the UI knows it's safe to trust the result.
  const awaitingPdf =
    allOk &&
    perTrf.some((t) => t.conseguiu === true && t.emitiuPdf === false);
  const situacao: Situacao = awaitingPdf
    ? "aguardando_pdf"
    : allOk
    ? "negativa"
    : anyFail
    ? "nao_emitida"
    : allNull
    ? "indeterminado"
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

/**
 * TJSP E-Proc — `tribunal/tjsp/eproc-lista`. Consulta informativa: retorna a
 * lista de processos eletrônicos da parte (1ª/2ª instância). Sem PDF. "consta"
 * quando há processos; o total real vem em `total_registros_real` (pode ser
 * maior que o array retornado, limitado a 100).
 */
function eprocListaExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const lista = Array.isArray(d.lista_processos)
    ? (d.lista_processos as unknown[])
    : [];
  const totalReal = Number(d.total_registros_real ?? lista.length) || 0;
  const consta = totalReal > 0;
  return {
    situacao: consta ? "positiva" : "negativa",
    validade: null,
    emissao: asString(d.data_consulta) ?? null,
    detalhes: consta
      ? `${totalReal} processo(s) eletrônico(s) no e-proc`
      : "Nada consta — sem processos no e-proc",
    consta_debito: consta,
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

/**
 * CENPROT Nacional (IEPTB) — `ieptb/protestos`. A resposta agrega protestos de
 * todas as UFs. Cada item de protesto/cartório de SP traz um token
 * `obter_detalhes` consumido depois por `ieptb/protestos-detalhes-sp` (o
 * executor lê esse token do `resp.data` cru, não daqui).
 *
 * Shape defensivo: o array de protestos pode vir em `d.protestos` ou aninhado
 * por cartório; consideramos "consta" quando encontramos qualquer protesto.
 * O breakdown por UF é best-effort — campos ausentes não quebram a normalização.
 */
function cenprotNacionalExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const protestos = collectProtestos(d);
  const consta = protestos.length > 0;
  // Breakdown por UF quando os itens trazem `uf`/`estado`.
  const porUf = new Map<string, number>();
  for (const p of protestos) {
    const ufRaw =
      asString((p as Record<string, unknown>).uf) ??
      asString((p as Record<string, unknown>).estado);
    const key = (ufRaw ?? "—").toUpperCase();
    porUf.set(key, (porUf.get(key) ?? 0) + 1);
  }
  const breakdown = Array.from(porUf.entries())
    .map(([k, n]) => `${k}: ${n}`)
    .join(", ");
  return {
    situacao: consta ? "positiva" : "negativa",
    validade: null,
    emissao: asString(d.data_consulta) ?? null,
    detalhes: consta
      ? `${protestos.length} protesto(s) encontrado(s)${breakdown ? ` (${breakdown})` : ""}`
      : "Nada consta",
    consta_debito: consta,
    raw: d,
  };
}

/**
 * Reúne protestos da resposta nacional de forma defensiva. Aceita tanto um
 * array plano em `d.protestos` quanto um agrupamento por cartório/estado com
 * sub-arrays de protestos.
 */
function collectProtestos(d: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const top = d.protestos;
  if (Array.isArray(top)) {
    for (const item of top) {
      if (
        item &&
        typeof item === "object" &&
        Array.isArray((item as Record<string, unknown>).protestos)
      ) {
        // Agrupamento por cartório: { cartorio, uf, protestos: [...] }
        out.push(...((item as Record<string, unknown>).protestos as unknown[]));
      } else {
        out.push(item);
      }
    }
  }
  // Alguns retornos usam `cartorios` como container.
  const cartorios = d.cartorios;
  if (Array.isArray(cartorios)) {
    for (const c of cartorios) {
      const sub = (c as Record<string, unknown>)?.protestos;
      if (Array.isArray(sub)) out.push(...sub);
    }
  }
  return out;
}

/**
 * CENPROT Nacional — Detalhes SP (`ieptb/protestos-detalhes-sp`). Retorna os
 * dados de um cartório de SP (devedor, valor, data, título). Tratamos como
 * "positiva" (há detalhe de protesto) e expomos um resumo legível.
 */
function cenprotDetalhesSpExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const protestos = collectProtestos(d);
  const cartorio = asString(d.cartorio) ?? asString(d.nome_cartorio);
  const parts: string[] = [];
  if (cartorio) parts.push(cartorio);
  if (protestos.length > 0) parts.push(`${protestos.length} título(s)`);
  return {
    situacao: protestos.length > 0 ? "positiva" : "informativa",
    validade: null,
    emissao: asString(d.data_consulta) ?? null,
    detalhes: parts.join(" · ") || "Detalhes do cartório SP",
    consta_debito: protestos.length > 0,
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

/**
 * Phase B — Cartão CNPJ: consulta de dados cadastrais, não tem "negativa/
 * positiva". Sempre emite um dump de atributos (razão social, CNAE, QSA,
 * endereço, situação). Usamos `situacao: "informativa"` para que a UI saiba
 * que não é uma certidão de regularidade — é um documento de consulta.
 */
function cnpjCartaoExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const situacao_cadastral = asString(d.situacao_cadastral);
  const razao = asString(d.razao_social) ?? asString(d.nome);
  const parts: string[] = [];
  if (razao) parts.push(razao);
  if (situacao_cadastral) parts.push(`Situação: ${situacao_cadastral}`);
  return {
    situacao: "informativa",
    validade: null,
    emissao: asString(d.data_emissao) ?? asString(d.data_consulta) ?? null,
    detalhes: parts.join(" — ") || "Consulta cadastral emitida",
    consta_debito: false,
    raw: d,
  };
}

/**
 * Phase B — CRF FGTS: certificado de regularidade. Resposta da Infosimples
 * para `caixa/regularidade` tem `situacao` ("Regular" / "Irregular") e
 * datas de validade do certificado.
 */
function crfFgtsExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const situacaoRaw = asString(d.situacao);
  const regular = situacaoRaw
    ? situacaoRaw.toLowerCase().includes("regular") &&
      !situacaoRaw.toLowerCase().includes("irregular")
    : undefined;
  const situacao: Situacao =
    regular === true ? "negativa" : regular === false ? "positiva" : "indeterminado";
  return {
    situacao,
    validade:
      asString(d.validade_fim_data) ??
      asString(d.data_validade) ??
      null,
    emissao:
      asString(d.validade_inicio_data) ??
      asString(d.data_emissao) ??
      null,
    detalhes: situacaoRaw ?? asString(d.mensagem) ?? null,
    consta_debito: regular === false,
    raw: d,
  };
}

/**
 * Phase B — Sefaz/PGE CNDT unificada. Resposta padronizada:
 *   { conseguiu_emitir_certidao_negativa, emissao_data, validade_data,
 *     certidao_codigo, mensagem }
 * Também usado por pge-sp/cndt.
 */
function sefazUnificadaExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const conseguiu = asBool(d.conseguiu_emitir_certidao_negativa);
  const consta = asBool(d.consta_debito);
  let situacao: Situacao;
  if (conseguiu === true && consta === false) situacao = "negativa";
  else if (consta === true) situacao = "positiva";
  else if (conseguiu === false) situacao = "nao_emitida";
  else situacao = "indeterminado";
  return {
    situacao,
    validade:
      asString(d.validade_data) ??
      asString(d.data_validade) ??
      asString(d.validade) ??
      null,
    emissao:
      asString(d.emissao_data) ??
      asString(d.data_emissao) ??
      null,
    detalhes: asString(d.mensagem) ?? asString(d.certidao_codigo) ?? null,
    consta_debito: consta === true,
    raw: d,
  };
}

/**
 * Phase K (2026-04-18) — CPF situação cadastral (Receita Federal).
 * Endpoint informativo: retorna status do CPF. Situação ≠ "Regular" bloqueia
 * minuta (Mapeamento 2.1.5).
 */
function receitaCpfExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const situacaoRaw = asString(d.situacao);
  const lower = situacaoRaw?.toLowerCase() ?? "";
  // Regular → informativa (OK). Qualquer outra → positiva (bloqueia).
  const regular = lower === "regular";
  const situacao: Situacao = regular ? "informativa" : situacaoRaw ? "positiva" : "indeterminado";
  const nome = asString(d.nome);
  const detalhesParts: string[] = [];
  if (nome) detalhesParts.push(nome);
  if (situacaoRaw) detalhesParts.push(`Situação: ${situacaoRaw}`);
  return {
    situacao,
    validade: null, // CPF não tem validade formal
    emissao: asString(d.comprovante_emissao) ?? asString(d.data_emissao) ?? null,
    detalhes: detalhesParts.join(" · ") || null,
    consta_debito: !regular && situacao === "positiva",
    raw: d,
  };
}

/**
 * Phase K — Antecedentes Criminais da Polícia Federal.
 * Resposta típica: { nada_consta: bool, resultado: "NADA CONSTA" | "CONSTA",
 * data_emissao, validade_ate, numero_controle }
 */
function antecedentesPfExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const nadaConsta = asBool(d.nada_consta);
  const resultado = asString(d.resultado);
  const situacao: Situacao =
    nadaConsta === true
      ? "negativa"
      : nadaConsta === false
      ? "positiva"
      : resultado?.toLowerCase().includes("nada consta")
      ? "negativa"
      : resultado?.toLowerCase().includes("consta")
      ? "positiva"
      : "indeterminado";
  return {
    situacao,
    validade: asString(d.validade_ate) ?? asString(d.data_validade) ?? null,
    emissao: asString(d.data_emissao) ?? null,
    detalhes: resultado ?? asString(d.numero_controle) ?? null,
    consta_debito: situacao === "positiva",
    raw: d,
  };
}

/**
 * Phase K — CCIR (INCRA) para imóveis rurais. Status: Regular / Em atraso /
 * Cancelado. Resposta típica: { situacao, exercicio, nirf, area_total_ha }.
 */
function ccirExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const situacaoRaw = asString(d.situacao)?.toLowerCase() ?? "";
  const situacao: Situacao = situacaoRaw.includes("regular")
    ? "negativa"
    : situacaoRaw.includes("atraso") || situacaoRaw.includes("cancel")
    ? "positiva"
    : "indeterminado";
  const nirf = asString(d.nirf);
  const municipio = asString(d.municipio);
  const areaHa = d.area_total_ha;
  const parts: string[] = [];
  if (nirf) parts.push(`NIRF ${nirf}`);
  if (municipio) parts.push(municipio);
  if (typeof areaHa === "number") parts.push(`${areaHa} ha`);
  return {
    situacao,
    validade: null, // CCIR não tem validade formal (exigível anualmente)
    emissao: asString(d.exercicio) ?? null,
    detalhes: parts.join(" · ") || asString(d.situacao) || null,
    consta_debito: situacao === "positiva",
    raw: d,
  };
}

/**
 * Phase K — Matrícula ONR (Certidão de Inteiro Teor). Resposta típica:
 * { numero_matricula, cartorio, tem_onus, ha_indisponibilidade, ha_penhora,
 *   ha_alienacao_fiduciaria, tipo_certidao, validade_ate }.
 */
function matriculaOnrExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const temOnus = asBool(d.tem_onus);
  const indisp = asBool(d.ha_indisponibilidade);
  const penhora = asBool(d.ha_penhora);
  const alienacao = asBool(d.ha_alienacao_fiduciaria);
  const temQualquerOnus =
    temOnus === true ||
    indisp === true ||
    penhora === true ||
    alienacao === true;
  const semOnus =
    temOnus === false &&
    (indisp === false || indisp === undefined) &&
    (penhora === false || penhora === undefined) &&
    (alienacao === false || alienacao === undefined);
  const situacao: Situacao = temQualquerOnus
    ? "positiva"
    : semOnus
    ? "negativa"
    : "indeterminado";
  const matricula = asString(d.numero_matricula);
  const cartorio = asString(d.cartorio);
  const tipo = asString(d.tipo_certidao);
  const parts: string[] = [];
  if (matricula) parts.push(`Matrícula ${matricula}`);
  if (cartorio) parts.push(cartorio);
  if (tipo) parts.push(tipo);
  // Surfacing dos gravames — é o dado central da diligência. Antes o card só
  // mostrava "positiva/negativa"; agora detalha quais ônus constam.
  const gravames: string[] = [];
  if (penhora === true) gravames.push("penhora");
  if (alienacao === true) gravames.push("alienação fiduciária");
  if (indisp === true) gravames.push("indisponibilidade");
  if (temOnus === true && gravames.length === 0) gravames.push("ônus registrado");
  if (temQualquerOnus) parts.push(`⚠️ Ônus: ${gravames.join(", ")}`);
  else if (semOnus) parts.push("sem ônus");
  return {
    situacao,
    validade: asString(d.validade_ate) ?? null,
    emissao: asString(d.data_emissao) ?? null,
    detalhes: parts.join(" · ") || null,
    consta_debito: temQualquerOnus,
    raw: d,
  };
}

/**
 * Phase L+ — Dados Cadastrais / Valor Venal SP (`pref/sp/sao-paulo/dados-imovel`).
 * Antes caía no `iptuExtractor` genérico (só negativa/positiva). Aqui é
 * informativo: expõe SQL, valor venal, área e uso do imóvel na Prefeitura SP.
 * Shape defensivo — campos ausentes não quebram a normalização.
 */
function dadosImovelSpExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const inscricao =
    asString(d.numero_contribuinte) ?? asString(d.sql) ?? asString(d.inscricao);
  const valorVenal =
    asString(d.valor_venal) ?? asString(d.valor_venal_imovel) ?? asString(d.valor_venal_referencia);
  const area =
    asString(d.area_construida) ?? asString(d.area_terreno) ?? asString(d.area);
  const uso = asString(d.uso) ?? asString(d.tipo_uso) ?? asString(d.tipo_imovel);
  const parts: string[] = [];
  if (inscricao) parts.push(`SQL ${inscricao}`);
  if (valorVenal) parts.push(`Valor venal R$ ${valorVenal}`);
  if (area) parts.push(`${area} m²`);
  if (uso) parts.push(uso);
  return {
    situacao: "informativa",
    validade: null,
    emissao: asString(d.data_consulta) ?? asString(d.data_emissao) ?? null,
    detalhes: parts.join(" · ") || "Dados cadastrais do imóvel",
    consta_debito: false,
    raw: d,
  };
}

/**
 * Phase L (2026-05-22) — ONR Mapa do Registro de Imóveis (pesquisa de bens).
 * Informativo: retorna a lista de imóveis em nome do CPF/CNPJ (cartório,
 * matrícula, data da última atualização). Não há negativa/positiva — `consta`
 * indica apenas se há imóveis localizados. Shape defensivo: a lista pode vir
 * em `imoveis`/`ocorrencias`/`bens`.
 */
function onrMapaExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const lista =
    (Array.isArray(d.imoveis) && (d.imoveis as unknown[])) ||
    (Array.isArray(d.ocorrencias) && (d.ocorrencias as unknown[])) ||
    (Array.isArray(d.bens) && (d.bens as unknown[])) ||
    [];
  const total = lista.length;
  return {
    situacao: "informativa",
    validade: null,
    emissao: asString(d.data_consulta) ?? asString(d.protocolo) ?? null,
    detalhes:
      total > 0
        ? `${total} imóvel(is) localizado(s) em nome da parte`
        : "Nenhum imóvel localizado",
    consta_debito: false,
    raw: d,
  };
}

/**
 * Phase L — Lista de pedidos de matrícula da conta ONR (`matric-lista`).
 * Informativo (reconciliação): não consome saldo do portal.
 */
function matriculaListaExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const pedidos = Array.isArray(d.pedidos)
    ? (d.pedidos as unknown[])
    : Array.isArray(d.lista)
    ? (d.lista as unknown[])
    : [];
  return {
    situacao: "informativa",
    validade: null,
    emissao: asString(d.data_consulta) ?? null,
    detalhes: `${pedidos.length} pedido(s) de matrícula na conta ONR`,
    consta_debito: false,
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
  "tribunal/tjsp/pedido-certidao": tjExtractor,
  "tribunal/tjsp/obter-certidao": tjExtractor,
  "tribunal/tjrj/pedido-cert": tjExtractor,
  "tribunal/tjrj/obter-certidao": tjExtractor,
  "tribunal/tjrs/primeiro-grau": tjExtractor,
  "tribunal/tjsp/eproc-lista": eprocListaExtractor,
  "cenprot-sp/protestos": cenprotSpExtractor,
  "pref/sp/sao-paulo/iptu": iptuExtractor,
  "pref/sp/sao-paulo/debitos-iptu": iptuExtractor,
  "pref/sp/sao-paulo/dados-imovel": dadosImovelSpExtractor,
  "pref/rj/rio-janeiro/cert-trib": iptuExtractor,
  "pref/rj/rio-janeiro/cnd": iptuExtractor,
  "pref/rj/rio-janeiro/iptu": iptuExtractor,
  // Phase L — municipais adicionais (8 capitais cobertas)
  "pref/mg/belo-horizonte/cndiptu": iptuExtractor,
  "pref/mg/belo-horizonte/cnd": iptuExtractor,
  "pref/rs/porto-alegre/cnd": iptuExtractor,
  "pref/pr/curitiba/cnd": iptuExtractor,
  "pref/sc/florianopolis/cnd": iptuExtractor,
  "pref/mt/cuiaba/cnd": iptuExtractor,
  // Phase B additions — share extractors where response shapes match.
  "tribunal/tjba/primeiro-grau": tjExtractor,
  "tribunal/tjgo/nada-consta": tjExtractor,
  "tribunal/tjdf/nada-consta": tjExtractor,
  "tribunal/tjsc/pedido-certidao": tjExtractor,
  "tribunal/tjms/pedido-cert": tjExtractor,
  "tribunal/tjms/obter-certidao": tjExtractor,
  "tribunal/tjmt/primeiro-grau-pf": tjExtractor,
  "tribunal/trt3/ceat": ceatExtractor,
  "tribunal/trt5/ceat": ceatExtractor,
  "tribunal/trt9/ceat": ceatExtractor,
  "tribunal/trt10/ceat": ceatExtractor,
  "tribunal/trt10/ceat-digital": ceatExtractor,
  "tribunal/trt12/ceat": ceatExtractor,
  "receita-federal/cnpj": cnpjCartaoExtractor,
  "caixa/regularidade": crfFgtsExtractor,
  // Phase K (2026-04-18) — gaps do Mapeamento_Certidoes.md
  "receita-federal/cpf": receitaCpfExtractor,
  "antecedentes-criminais/pf/emit": antecedentesPfExtractor,
  "antecedentes-criminais/pf/val": antecedentesPfExtractor,
  "sncr/ccir": ccirExtractor,
  "registradores/matric/pedido": matriculaOnrExtractor,
  "registradores/matric/download": matriculaOnrExtractor,
  "registradores/matric/lista": matriculaListaExtractor,
  "onr/mapa-registro-imoveis": onrMapaExtractor,
  "sefaz/certidao-debitos": sefazUnificadaExtractor,
  "pge-sp/cndt": sefazUnificadaExtractor,
  // Phase F.II-γ — TRF individuais + CENPROT nacional
  "tribunal/trf1/certidao": tjExtractor,
  "tribunal/trf2/certidao": tjExtractor,
  "tribunal/trf3/certidao": tjExtractor,
  "tribunal/trf4/certidao": tjExtractor,
  "tribunal/trf5/certidao": tjExtractor,
  "tribunal/trf6/certidao": tjExtractor,
  "ieptb/protestos": cenprotNacionalExtractor,
  "ieptb/protestos-detalhes-sp": cenprotDetalhesSpExtractor,
};

export function normalize(
  endpoint: string,
  resp: InfosimplesResponse
): NormalizedResult {
  if (resp.code !== 200) {
    // I.10 (2026-06-01) — a Infosimples às vezes põe a razão GENÉRICA em
    // `code_message` ("A consulta não foi validada antes de pesquisar a fonte
    // de origem.") e a razão ESPECÍFICA só no array `errors[]` (ex.: 604 do
    // e-SAJ pedido-certidao → "Não é possível utilizar o mesmo email múltiplas
    // vezes..."). Classificar só pelo code_message fazia o 604 throttle cair em
    // account_issue (failed_permanent) E tripar o circuit-breaker de crédito da
    // org (isOrgInfosimplesBlocked), bloqueando o lote inteiro com "Crédito
    // esgotado" enganoso. Passa o texto combinado pro mapeador discriminar.
    const combinedMessage =
      [resp.code_message, ...(resp.errors ?? [])].filter(Boolean).join(" ") ||
      null;
    const category = mapInfosimplesCodeToCategory(resp.code, combinedMessage);
    // H.1 (Phase H, 2026-04-18): code 602 ("URL inválida") foi remapeado
    // de genuine_no_data → integration_error em error-codes.ts para evitar
    // falso-negativo em TRF3/PGE-SP (endpoint depreciado retornava "negativa"
    // sem PDF). Mantém semântica: genuine_no_data=portal confirmou ausência,
    // integration_error=bug nosso, portal_unavailable=tente de novo.
    let situacao: Situacao;
    if (category === "genuine_no_data") situacao = "negativa";
    else if (category === "unknown") situacao = "indeterminado";
    else situacao = "nao_emitida";
    // I.7 (2026-05-11) — Infosimples retorna detalhe específico do erro no
    // array `errors[]` (ex: TJSP code 606 → ["CPF e senha ou certificado
    // digital devem ser informados para login com gov.br"]). Antes só
    // líamos `code_message` que é genérico ("Parâmetros obrigatórios não
    // foram enviados"). Agora prepend os errors específicos pra que o
    // classifier + UI mostrem o motivo real.
    const errorsText = resp.errors?.filter(Boolean).join("; ") || null;
    const detalhes = errorsText
      ? errorsText + (resp.code_message ? ` (${resp.code_message})` : "")
      : resp.code_message || null;
    // CENPROT/IEPTB "não constam protestos" chega como 6xx (sem PDF). É uma
    // negativa legítima — não uma falha. Marca situacao "negativa" +
    // genuine_no_data; o classifier (isProtestoNadaConsta) fecha como success
    // verde "nada consta". Ver isProtestoNadaConsta em error-codes.ts.
    if (isProtestoNadaConsta(endpoint, detalhes)) {
      return {
        situacao: "negativa",
        validade: null,
        emissao: null,
        detalhes: "Nada consta — sem protestos registrados",
        consta_debito: false,
        failureCategory: "genuine_no_data",
        raw: resp,
      };
    }
    return {
      situacao,
      validade: null,
      emissao: null,
      detalhes,
      consta_debito: false,
      failureCategory: category,
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
