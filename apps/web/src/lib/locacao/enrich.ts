// Form/dados → template bridge para locação (espelha enrichContractData de
// venda, mas isolado). Idempotente: nunca sobrescreve destino já preenchido.
// Ver docs/locacao/spec.md §7. Mantém a lógica de timezone (âncora ao meio-dia)
// usada no resto do app pra strings YYYY-MM-DD não deslizarem em UTC-3.

const MEIO_PAGAMENTO_ALUGUEL_TEXTO: Record<string, string> = {
  pix: "PIX",
  boleto: "boleto bancário registrado",
  qualquer: "",
};

// Rótulo legível do tipo do imóvel (evita slug cru tipo "comercial_sala" no
// corpo do contrato). Em minúsculas pois entra no meio da frase ("o imóvel de
// tipo sala comercial, situado em…"). Fallback troca "_" por espaço.
const TIPO_IMOVEL_TEXTO: Record<string, string> = {
  apartamento: "apartamento",
  casa: "casa",
  comercial_sala: "sala comercial",
  loja: "loja",
  galpao: "galpão",
  terreno: "terreno",
  temporada: "imóvel de temporada",
};

// Parse YYYY-MM-DD âncora ao meio-dia local (estável em UTC-3).
function parseLocalDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const dt = ymd
    ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0)
    : new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatLongPtBr(dt: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dt);
}

export interface EnrichLocacaoContext {
  // Imobiliária que administra a locação (cláusula de pagamento do template
  // v3). Vem da Organization na geração; sem nome o template cai no fallback
  // "à PARTE LOCADORA ou a quem esta indicar".
  administradora?: {
    nome?: string;
    cnpj?: string;
    creci?: string;
    endereco?: string;
  };
}

export function enrichLocacaoData(
  data: Record<string, unknown>,
  ctx?: EnrichLocacaoContext
): Record<string, unknown> {
  const enriched = { ...data };
  const config = ((enriched.config as Record<string, unknown>) || {}) as Record<string, unknown>;

  // Defaults da casa (caso venham de import/agente sem passar pelo Zod).
  // Multa de atraso 10% — padrão do modelo NNI; Lei 8.245/91 não impõe 2%.
  if (config.multa_atraso_percent == null) config.multa_atraso_percent = 10;
  if (config.juros_mensais_atraso == null) config.juros_mensais_atraso = 1;
  if (config.multa_rescisoria_meses == null) config.multa_rescisoria_meses = 3;

  // Administradora da locação — idempotente: dataJson já preenchido vence.
  const adm = ctx?.administradora;
  if (adm?.nome && (config.administradora_nome == null || config.administradora_nome === "")) {
    config.administradora_nome = adm.nome;
    if (adm.creci && (config.administradora_creci == null || config.administradora_creci === "")) {
      config.administradora_creci = adm.creci;
    }
    if (adm.endereco && (config.administradora_endereco == null || config.administradora_endereco === "")) {
      config.administradora_endereco = adm.endereco;
    }
  }

  const aluguel = ((enriched.aluguel as Record<string, unknown>) || {}) as Record<string, unknown>;
  const imovel = (enriched.imovel as Record<string, unknown> | undefined) || {};
  const assinatura = enriched.assinatura as
    | { cidade?: string; uf?: string; data?: string }
    | undefined;

  // Município/data do fecho — preferência assinatura, fallback imóvel.
  if (config.municipio_imovel == null || config.municipio_imovel === "") {
    const cidade =
      (typeof assinatura?.cidade === "string" && assinatura.cidade.trim()) ||
      (typeof imovel.cidade === "string" ? (imovel.cidade as string).trim() : "");
    const uf =
      (typeof assinatura?.uf === "string" && assinatura.uf.trim()) ||
      (typeof imovel.uf === "string" ? (imovel.uf as string).trim() : "");
    if (cidade) config.municipio_imovel = uf ? `${cidade}/${uf}` : cidade;
  }
  if (
    (config.data_assinatura == null || config.data_assinatura === "") &&
    typeof assinatura?.data === "string" &&
    assinatura.data.trim()
  ) {
    config.data_assinatura = assinatura.data.trim();
  }

  // Texto do meio de pagamento do aluguel mensal.
  if (config.meio_pagamento_texto == null) {
    const meio = typeof aluguel.meio_pagamento === "string" ? aluguel.meio_pagamento : "pix";
    const txt = MEIO_PAGAMENTO_ALUGUEL_TEXTO[meio] ?? "";
    if (txt) config.meio_pagamento_texto = txt;
  }

  // Rótulo legível do tipo do imóvel (kind é um enum/slug do form).
  const kind = typeof imovel.kind === "string" ? imovel.kind : "";
  if (kind && (imovel.tipo_texto == null || imovel.tipo_texto === "")) {
    imovel.tipo_texto = TIPO_IMOVEL_TEXTO[kind] ?? kind.replace(/_/g, " ");
    enriched.imovel = imovel;
  }

  // Foro eleito (campo "Foro (comarca)" do form, top-level). Vazio => o template
  // mantém o fallback "comarca de localização do imóvel".
  if (config.foro_texto == null || config.foro_texto === "") {
    const foro =
      (typeof enriched.foro === "string" && enriched.foro.trim()) ||
      (typeof config.foro === "string" ? (config.foro as string).trim() : "");
    if (foro) config.foro_texto = foro;
  }

  // Vigência início/fim em texto longo PT-BR a partir de início + meses.
  const inicioRaw = typeof aluguel.vigencia_inicio === "string" ? aluguel.vigencia_inicio : "";
  const meses = Number(aluguel.vigencia_meses) || 0;
  const inicio = parseLocalDate(inicioRaw);
  if (inicio) {
    if (config.vigencia_inicio_texto == null) {
      config.vigencia_inicio_texto = formatLongPtBr(inicio);
    }
    if (config.vigencia_fim_texto == null && meses > 0) {
      const fim = new Date(inicio);
      fim.setMonth(fim.getMonth() + meses);
      // Término: véspera do "mesmo dia" N meses depois (locação fecha no
      // último dia do período contratado).
      fim.setDate(fim.getDate() - 1);
      config.vigencia_fim_texto = formatLongPtBr(fim);
    }
  }

  enriched.config = config;
  return enriched;
}

// ============================================================================
// Contrato de Administração de Locação (template administracao_locacao_v1).
// Estende enrichLocacaoData com os campos que só esse instrumento usa.
// Idempotente como o resto: dataJson preenchido vence os defaults.
// ============================================================================
export function enrichAdministracaoData(
  data: Record<string, unknown>,
  ctx?: EnrichLocacaoContext
): Record<string, unknown> {
  const enriched = enrichLocacaoData(data, ctx);
  const config = ((enriched.config as Record<string, unknown>) || {}) as Record<string, unknown>;

  // CNPJ da administradora — o enrich base só injeta nome/CRECI/endereço
  // (bloco condicionado a `adm.nome` acima; aqui repetimos o guard pra
  // administradora sem nome não deixar CNPJ órfão no preâmbulo).
  const adm = ctx?.administradora;
  if (
    adm?.nome &&
    adm.cnpj &&
    (config.administradora_cnpj == null || config.administradora_cnpj === "")
  ) {
    config.administradora_cnpj = adm.cnpj;
  }

  // Taxa de administração — fonte é o bloco fiscal operador-only do form;
  // fallback aluguel.taxa_admin_percent; default da casa 10%.
  if (config.taxa_admin_percent == null) {
    const fiscal = (enriched.fiscal as Record<string, unknown> | undefined) || {};
    const aluguel = (enriched.aluguel as Record<string, unknown> | undefined) || {};
    const taxa =
      Number(fiscal.taxa_admin_percent) ||
      Number(aluguel.taxa_admin_percent) ||
      10;
    config.taxa_admin_percent = taxa;
  }

  // Prazo de repasse em texto (cláusula 6ª). LeaseContract.repasseTipo/Dia
  // ainda não vêm do form — default da casa.
  if (config.repasse_texto == null || config.repasse_texto === "") {
    config.repasse_texto = "em até 5 (cinco) dias úteis após o efetivo recebimento";
  }

  // Exclusividade default sim (cláusula 8ª é condicional no template).
  if (config.administracao_exclusiva == null) {
    config.administracao_exclusiva = true;
  }

  enriched.config = config;
  return enriched;
}
