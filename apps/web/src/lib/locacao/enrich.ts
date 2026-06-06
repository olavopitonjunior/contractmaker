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

export function enrichLocacaoData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const enriched = { ...data };
  const config = ((enriched.config as Record<string, unknown>) || {}) as Record<string, unknown>;

  // Defaults legais (caso venham de import/agente sem passar pelo Zod).
  if (config.multa_atraso_percent == null) config.multa_atraso_percent = 2;
  if (config.juros_mensais_atraso == null) config.juros_mensais_atraso = 1;
  if (config.multa_rescisoria_meses == null) config.multa_rescisoria_meses = 3;

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
