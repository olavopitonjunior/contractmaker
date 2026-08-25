// Form/dados → template bridge para locação (espelha enrichContractData de
// venda, mas isolado). Idempotente: nunca sobrescreve destino já preenchido.
// Ver docs/locacao/spec.md §7. Mantém a lógica de timezone (âncora ao meio-dia)
// usada no resto do app pra strings YYYY-MM-DD não deslizarem em UTC-3.

import {
  DEFAULT_LOCACAO_SETTINGS,
  type LocacaoSettings,
} from "@/lib/contracts/default-config";
import { normalizeGarantiaTipo } from "@/lib/contracts/template-category";

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

// Seguro-fiança / garantia onerosa: tomador da apólice e vigência escolhidos no
// formulário viram texto pronto pra cláusula de garantia. Sem escolha, nenhuma
// chave é materializada — o template mantém a redação genérica.
const SEGURO_TOMADOR_TEXTO: Record<string, string> = {
  inquilino: "o LOCATÁRIO",
  proprietario: "o LOCADOR",
};

const SEGURO_VIGENCIA_TEXTO: Record<string, string> = {
  anual_renovavel: "com renovação anual obrigatória enquanto durar a locação",
  prazo_contrato: "pelo prazo integral da locação",
};

// Como os encargos transitam quando a imobiliária administra (cláusula de
// encargos do v3). Escolhido no form (aluguel.encargos_repasse).
const ENCARGOS_REPASSE_TEXTO: Record<string, string> = {
  paga_e_retem:
    "pagos diretamente pela ADMINISTRADORA e deduzidos do repasse mensal devido à PARTE LOCADORA",
  repasse_integral:
    "lançados integralmente na cobrança mensal da PARTE LOCATÁRIA, junto com o aluguel",
};

const CONTA_CONSUMO_TEXTO: Record<string, string> = {
  agua: "água",
  luz: "energia elétrica",
  gas: "gás",
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
  /**
   * Padrão contratual de LOCAÇÃO da org (`contractDefaultsJson.locacao`).
   * Sobrepõe o padrão de fábrica. Omitir é seguro: cai em
   * `DEFAULT_LOCACAO_SETTINGS` — é por isso que o fallback mora aqui, e não na
   * geração: preview de template, parity test e placeholder-map chamam este
   * enrich sem ctx.
   */
  contractDefaults?: LocacaoSettings;
}

export function enrichLocacaoData(
  data: Record<string, unknown>,
  ctx?: EnrichLocacaoContext
): Record<string, unknown> {
  const enriched = { ...data };
  const config = ((enriched.config as Record<string, unknown>) || {}) as Record<string, unknown>;

  // Configurações contratuais: padrão da ORG > padrão de fábrica. Aditivo —
  // dataJson que já tem o valor (form, import, agente) mantém o dele.
  const settings = ctx?.contractDefaults ?? DEFAULT_LOCACAO_SETTINGS;
  for (const [key, value] of Object.entries(settings.config)) {
    if (config[key] == null) config[key] = value;
  }
  // Comarca e local/data do fecho só entram quando a org definiu algo — vazio
  // deixa o template no fallback ("comarca de localização do imóvel").
  if (settings.foro && (enriched.foro == null || enriched.foro === "")) {
    enriched.foro = settings.foro;
  }
  // Local/data do fecho: merge CAMPO A CAMPO, não objeto inteiro. O wizard
  // sempre mandou `assinatura: { cidade: "", uf: "", data: "" }` no dataJson —
  // com a checagem antiga (`== null`) o padrão da org nunca era aplicado.
  // Virou bloqueante em 2026-07-30, quando a etapa de Confirmação saiu do
  // formulário e a cidade/UF passaram a vir SÓ da configuração da imobiliária.
  {
    const atual = (enriched.assinatura as Record<string, unknown> | undefined) ?? undefined;
    const merged: Record<string, unknown> = { ...(atual ?? {}) };
    let preencheu = false;
    for (const key of ["cidade", "uf", "data"] as const) {
      const valorAtual = merged[key];
      const vazio =
        valorAtual == null ||
        (typeof valorAtual === "string" && valorAtual.trim() === "");
      if (vazio && settings.assinatura[key]) {
        merged[key] = settings.assinatura[key];
        preencheu = true;
      }
    }
    if (preencheu || atual != null) enriched.assinatura = merged;
  }

  // Administradora da locação — idempotente: dataJson já preenchido vence.
  // Desde 2026-08 o FORM decide se há administração (aluguel.adm_imobiliaria):
  // com "não" explícito, a org NÃO é nomeada administradora no contrato de
  // locação (as cláusulas condicionadas a administradora_nome caem no fallback
  // "diretamente à PARTE LOCADORA"). Ausente = form antigo, comportamento de
  // sempre. O instrumento de ADMINISTRAÇÃO re-injeta por conta própria.
  const admFormDecision = (
    (enriched.aluguel as Record<string, unknown> | undefined) ?? {}
  ).adm_imobiliaria;
  const adm = admFormDecision === false ? undefined : ctx?.administradora;
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

  // `garantia.tipo` canônico ANTES de qualquer condicional do template. O
  // contrato decide a cláusula por `(eq garantia.tipo "…")`, então um dataJson
  // gravado antes do rename `garantia_digital` → `garantia_onerosa` (inclusive
  // o snapshot congelado em Contract.dataJson, que a migration não toca) cairia
  // no ramo genérico do `{{else}}`. Só reescreve quando há o que reescrever.
  {
    const atual = enriched.garantia as Record<string, unknown> | undefined;
    if (atual && typeof atual === "object") {
      const canonico = normalizeGarantiaTipo(atual.tipo);
      if (canonico && canonico !== atual.tipo) {
        enriched.garantia = { ...atual, tipo: canonico };
      }
    }
  }

  // Seguro-fiança/garantia onerosa: tomador e vigência da apólice em texto.
  // Idempotente e sem default — quem não escolheu não ganha frase.
  const garantia = (enriched.garantia as Record<string, unknown> | undefined) || {};
  if (config.seguro_tomador_texto == null || config.seguro_tomador_texto === "") {
    const tomador =
      typeof garantia.seguro_tomador === "string" ? garantia.seguro_tomador : "";
    const txt = SEGURO_TOMADOR_TEXTO[tomador];
    if (txt) config.seguro_tomador_texto = txt;
  }
  if (config.seguro_vigencia_texto == null || config.seguro_vigencia_texto === "") {
    const vig =
      typeof garantia.seguro_vigencia === "string" ? garantia.seguro_vigencia : "";
    const txt = SEGURO_VIGENCIA_TEXTO[vig];
    if (txt) config.seguro_vigencia_texto = txt;
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

  // ==========================================================================
  // Administração/despesas decididas no form (etapa 4, 2026-08). Booleans e
  // textos prontos pras cláusulas de pagamento (4) e encargos (9) do v3.
  // Idempotente e sem default: form antigo não materializa nada.
  // ==========================================================================
  if (config.adm_imobiliaria == null && typeof aluguel.adm_imobiliaria === "boolean") {
    config.adm_imobiliaria = aluguel.adm_imobiliaria;
  }
  // Cláusula rescisória: default TRUE (comportamento histórico do v3) — só o
  // "Não" explícito do form omite a cláusula 7.2. Materializado aqui pra o
  // template poder usar {{#if config.clausula_rescisoria}} com dataJson antigo.
  if (config.clausula_rescisoria == null) {
    config.clausula_rescisoria = true;
  }
  if (aluguel.adm_imobiliaria === true) {
    if (config.taxa_admin_percent == null) {
      // 0% explícito é válido (isenção negociada) — só o AUSENTE cai no
      // default 10. `> 0` aqui viraria 10% num contrato assinado enquanto
      // LeaseContract.taxaAdminPercent gravaria 0 (divergência financeira).
      const taxa = Number(aluguel.taxa_admin_percent);
      config.taxa_admin_percent =
        aluguel.taxa_admin_percent != null && Number.isFinite(taxa) && taxa >= 0
          ? taxa
          : 10;
    }
    const repasse =
      typeof aluguel.encargos_repasse === "string" ? aluguel.encargos_repasse : "";
    if (repasse && config.encargos_repasse == null) {
      config.encargos_repasse = repasse;
    }
    if (config.encargos_repasse_texto == null || config.encargos_repasse_texto === "") {
      const txt = ENCARGOS_REPASSE_TEXTO[repasse];
      if (txt) config.encargos_repasse_texto = txt;
    }
  }
  if (
    config.contas_consumo_individualizadas == null &&
    typeof aluguel.contas_consumo_individualizadas === "boolean"
  ) {
    config.contas_consumo_individualizadas = aluguel.contas_consumo_individualizadas;
  }
  if (
    aluguel.contas_consumo_individualizadas === false &&
    (config.contas_no_condominio_texto == null || config.contas_no_condominio_texto === "")
  ) {
    const contas = Array.isArray(aluguel.contas_no_condominio)
      ? (aluguel.contas_no_condominio as unknown[])
          .map((c) => CONTA_CONSUMO_TEXTO[String(c)])
          .filter(Boolean)
      : [];
    if (contas.length > 0) {
      config.contas_no_condominio_texto =
        contas.length === 1
          ? contas[0]
          : `${contas.slice(0, -1).join(", ")} e ${contas[contas.length - 1]}`;
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

  // O enrich base PULA a injeção da administradora quando o form diz
  // aluguel.adm_imobiliaria === false (decisão vale pro contrato de LOCAÇÃO).
  // Este instrumento é a própria relação imobiliária↔proprietário, então aqui
  // a administradora entra sempre que a org tiver os dados.
  const adm = ctx?.administradora;
  if (adm?.nome && (config.administradora_nome == null || config.administradora_nome === "")) {
    config.administradora_nome = adm.nome;
    if (adm.creci && (config.administradora_creci == null || config.administradora_creci === "")) {
      config.administradora_creci = adm.creci;
    }
    if (
      adm.endereco &&
      (config.administradora_endereco == null || config.administradora_endereco === "")
    ) {
      config.administradora_endereco = adm.endereco;
    }
  }

  // CNPJ da administradora — guard repetido pra administradora sem nome não
  // deixar CNPJ órfão no preâmbulo.
  if (
    adm?.nome &&
    adm.cnpj &&
    (config.administradora_cnpj == null || config.administradora_cnpj === "")
  ) {
    config.administradora_cnpj = adm.cnpj;
  }

  // Taxa de administração — fonte é o bloco fiscal operador-only do form;
  // fallback aluguel.taxa_admin_percent; default da casa 10%. Nullish-aware:
  // 0% explícito em qualquer fonte é respeitado (não cai pro próximo).
  if (config.taxa_admin_percent == null) {
    const fiscal = (enriched.fiscal as Record<string, unknown> | undefined) || {};
    const aluguel = (enriched.aluguel as Record<string, unknown> | undefined) || {};
    let taxa = 10;
    for (const candidate of [fiscal.taxa_admin_percent, aluguel.taxa_admin_percent]) {
      const n = Number(candidate);
      if (candidate != null && Number.isFinite(n) && n >= 0) {
        taxa = n;
        break;
      }
    }
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
