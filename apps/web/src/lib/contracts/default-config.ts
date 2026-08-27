import { z } from "zod";

/**
 * Configurações contratuais (multas, juros, foro, desistência, local/data de
 * assinatura) — o que antes o cliente respondia na última etapa do formulário
 * público e passou a ser decisão da imobiliária, editável na aba
 * "Configurações" do editor de contrato.
 *
 * Este módulo é a fonte única desses valores. É importado por:
 *   - `SalesFormWizard` (defaults do form legado; ver nota de retrocompat)
 *   - `enrichContractData` (fallback na geração — ver §Fallback)
 *   - o painel de Configurações do editor e o endpoint que o persiste
 *   - a tela de padrões da org
 *
 * ## Por que o padrão por org é `{ venda, locacao }`
 *
 * `foro` NÃO significa a mesma coisa nas duas esteiras: em venda é um enum
 * (arbitragem | justica-publica, e os templates v2 trocam a cláusula inteira
 * com `{{#if (eq foro "arbitragem")}}`); em locação é a comarca em texto livre
 * ("São Paulo/SP"). Os blocos `config` também divergem (locação tem
 * `multa_atraso_percent`/`multa_rescisoria_meses`). Um padrão único por org
 * corromperia uma das duas — por isso a coluna é namespaced por módulo, e cada
 * branch tem schema, padrão de fábrica, extract e patch próprios.
 */

/**
 * Sem `.default()` nos campos de propósito: o schema descreve um objeto
 * COMPLETO. Os valores de piso moram em `DEFAULT_CONTRACT_SETTINGS` (e o
 * caminho parcial é o `resolveOrgContractDefaults`). Isso mantém input e output
 * do Zod idênticos — com defaults, `z.input` teria tudo opcional e o
 * `zodResolver` do painel não casaria com o tipo do formulário.
 */
export const contractSettingsSchema = z.object({
  desistencia: z.object({
    permite: z.boolean(),
    prazo_dias: z.number().int().min(1).max(365),
  }),
  foro: z.enum(["arbitragem", "justica-publica"]),
  assinatura: z.object({
    cidade: z.string().max(120),
    uf: z.string().max(2),
    // "" = usar a data em que o contrato for assinado (o template cai no
    // fallback do enrich); senão ISO yyyy-mm-dd.
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser AAAA-MM-DD")
      .or(z.literal("")),
  }),
  config: z.object({
    multa_penal_moratoria: z.number().min(0).max(100),
    base_calculo_multa: z.string().max(200),
    juros_mensais_atraso: z.number().min(0).max(100),
    atualizacao_monetaria: z.string().max(100),
    prazo_atraso_rescisao: z.number().int().min(1).max(365),
    multa_cominatoria_diaria: z.number().min(0),
    multa_penal_compensatoria: z.number().min(0).max(100),
    prazo_multa_rescisoria: z.number().int().min(1).max(365),
  }),
});

export type ContractSettings = z.infer<typeof contractSettingsSchema>;

/**
 * Padrão de fábrica.
 *
 * ATENÇÃO — estes valores são o TEXTO JURÍDICO que os templates v2 já
 * praticavam, não os defaults do formulário antigo. A diferença importa:
 *
 * Antes de os templates serem parametrizados, esses 8 campos eram coletados no
 * form mas IGNORADOS — os v2 traziam os números escritos à mão nas cláusulas.
 * E os dois conjuntos divergiam: o form default-ava multa compensatória 10%,
 * multa diária R$ 150 e purgação em 10 dias, enquanto as cláusulas diziam 5%,
 * R$ 500,00 e 15 dias. Adotar os defaults do form ao parametrizar teria DOBRADO
 * as perdas e danos de todo contrato novo, silenciosamente.
 *
 * Então o piso é o que o contrato já dizia. Mudar daqui pra frente é decisão
 * explícita da imobiliária, na aba Configurações.
 * `apps/web/src/__tests__/template-params-parity.test.ts` trava isso: o HTML
 * renderizado com estes defaults tem que bater byte a byte com o de antes da
 * parametrização.
 */
export const DEFAULT_CONTRACT_SETTINGS: ContractSettings = {
  desistencia: { permite: false, prazo_dias: 7 },
  foro: "arbitragem",
  assinatura: { cidade: "", uf: "", data: "" },
  config: {
    multa_penal_moratoria: 2,
    base_calculo_multa: "valor da obrigação inadimplida",
    juros_mensais_atraso: 1,
    atualizacao_monetaria: "IPCA/IBGE",
    prazo_atraso_rescisao: 15,
    multa_cominatoria_diaria: 500,
    multa_penal_compensatoria: 5,
    prazo_multa_rescisoria: 30,
  },
};

/**
 * Configurações contratuais de LOCAÇÃO.
 *
 * Não é um subconjunto do shape de venda — é outro vocabulário:
 *
 *  - `foro` é a COMARCA em texto livre ("São Paulo/SP"), não o enum
 *    arbitragem|justica-publica. Vazio = o template mantém o fallback
 *    "comarca de localização do imóvel".
 *  - `config` tem multa de atraso (% sobre o aluguel), juros mensais, a multa
 *    rescisória expressa em MESES de aluguel (art. 4º da Lei 8.245/91), não em
 *    percentual sobre o valor do negócio, e os honorários advocatícios (% sobre
 *    o débito, cobrados na via judicial/extrajudicial).
 *
 * `assinatura` é o único bloco compartilhado com venda (cidade/UF/data do
 * fecho) — `enrichLocacaoData` consome exatamente os mesmos campos pra
 * materializar `config.municipio_imovel` e `config.data_assinatura`.
 */
export const locacaoSettingsSchema = z
  .object({
    foro: z.string().max(160),
    assinatura: z
      .object({
        cidade: z.string().max(120),
        uf: z.string().max(2),
        // "" = usar a data em que o contrato for assinado.
        data: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser AAAA-MM-DD")
          .or(z.literal("")),
      })
      .strict(),
    config: z
      .object({
        multa_atraso_percent: z.number().min(0).max(100),
        juros_mensais_atraso: z.number().min(0).max(100),
        multa_rescisoria_meses: z.number().min(0).max(120),
        honorarios_advocaticios_percent: z.number().min(0).max(100),
      })
      .strict(),
  })
  .strict();

export type LocacaoSettings = z.infer<typeof locacaoSettingsSchema>;

/**
 * Padrão de fábrica da locação.
 *
 * São os mesmos números que `enrichLocacaoData` praticava hard-coded desde a
 * primeira versão do módulo — multa de atraso 10% (padrão do modelo NNI; a Lei
 * 8.245/91 não impõe os 2% do CDC), juros de 1% ao mês e multa rescisória de 3
 * aluguéis. Os honorários advocatícios de 10% são o que as cláusulas de locação
 * já praticavam escritas à mão. Mudar daqui pra frente é decisão explícita da
 * imobiliária.
 */
export const DEFAULT_LOCACAO_SETTINGS: LocacaoSettings = {
  foro: "",
  assinatura: { cidade: "", uf: "", data: "" },
  config: {
    multa_atraso_percent: 10,
    juros_mensais_atraso: 1,
    multa_rescisoria_meses: 3,
    honorarios_advocaticios_percent: 10,
  },
};

/**
 * Padrão COMERCIAL da locação — a comissão que a imobiliária cobra pela
 * intermediação do 1º aluguel.
 *
 * Chave irmã de `locacao`, e não um campo dentro dela, de propósito:
 * `locacaoSettingsSchema` é `.strict()` e descreve as CLÁUSULAS do contrato
 * (foro, multas, juros) — é o que `api/contracts/[id]/settings` valida por
 * contrato e o que o `ContractSettingsPanel` edita. Enfiar comissão ali faria
 * aquele PATCH exigir um campo que o painel não envia, e passaria a decisão
 * comercial pelo painel jurídico.
 */
export const locacaoComissaoDefaultsSchema = z
  .object({
    forma: z.enum(["percentual", "valor_fixo"]),
    /** % do 1º aluguel (forma = percentual). */
    taxa_locacao_percent: z.number().min(0).max(100),
    /** R$ à vista (forma = valor_fixo). */
    taxa_locacao_valor: z.number().min(0),
  })
  .strict();

export type LocacaoComissaoDefaults = z.infer<
  typeof locacaoComissaoDefaultsSchema
>;

/**
 * Zero em tudo = "a imobiliária ainda não configurou". O formulário nasce vazio
 * como sempre nasceu; quem preencher o padrão passa a ver o campo pré-populado.
 */
export const DEFAULT_LOCACAO_COMISSAO: LocacaoComissaoDefaults = {
  forma: "percentual",
  taxa_locacao_percent: 0,
  taxa_locacao_valor: 0,
};

/** Shape de `OrgFormSettings.contractDefaultsJson`. */
export const orgContractDefaultsSchema = z.object({
  venda: contractSettingsSchema.deepPartial().optional(),
  locacao: locacaoSettingsSchema.deepPartial().optional(),
  locacao_comissao: locacaoComissaoDefaultsSchema.deepPartial().optional(),
});

export type OrgContractDefaults = z.infer<typeof orgContractDefaultsSchema>;

/** Famílias de configuração contratual — uma por esteira. */
export type SettingsFamily = "venda" | "locacao";

/**
 * Descobre a família de um contrato.
 *
 * `pipeline.kind` é a fonte primária (o Deal não tem orgId/kind confiável em
 * todo caminho); `Contract.kind="administracao"` é locação por definição —
 * é o instrumento imobiliária ↔ proprietário.
 */
export function resolveSettingsFamily(input: {
  contractKind?: string | null;
  pipelineKind?: string | null;
}): SettingsFamily {
  if (input.contractKind === "administracao") return "locacao";
  return input.pipelineKind === "locacao" ? "locacao" : "venda";
}

/**
 * Campos que só existem na OUTRA família.
 *
 * Zod sozinho não pega o caso perigoso: um payload de venda tem `foro:
 * "arbitragem"`, que é uma string válida como comarca, e o `.strip()` padrão
 * descartaria `desistencia`/`config.multa_penal_*` em silêncio — o operador
 * veria "salvo" e o contrato não mudaria. Aqui o mismatch vira 400 nomeando
 * exatamente o que veio errado.
 */
const VENDA_ONLY_TOP_KEYS = ["desistencia"] as const;
const VENDA_ONLY_CONFIG_KEYS = [
  "multa_penal_moratoria",
  "base_calculo_multa",
  "atualizacao_monetaria",
  "prazo_atraso_rescisao",
  "multa_cominatoria_diaria",
  "multa_penal_compensatoria",
  "prazo_multa_rescisoria",
] as const;
const LOCACAO_ONLY_CONFIG_KEYS = [
  "multa_atraso_percent",
  "multa_rescisoria_meses",
  "honorarios_advocaticios_percent",
] as const;

type AnyObj = Record<string, unknown>;
const obj = (v: unknown): AnyObj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as AnyObj) : {};

export function foreignSettingsFields(
  family: SettingsFamily,
  payload: unknown
): string[] {
  const data = obj(payload);
  const config = obj(data.config);
  const found: string[] = [];

  if (family === "locacao") {
    for (const k of VENDA_ONLY_TOP_KEYS) if (k in data) found.push(k);
    for (const k of VENDA_ONLY_CONFIG_KEYS) if (k in config) found.push(`config.${k}`);
  } else {
    for (const k of LOCACAO_ONLY_CONFIG_KEYS) if (k in config) found.push(`config.${k}`);
  }
  return found;
}

// `Number(null)` e `Number("")` são 0 (finito!), então checar só
// `Number.isFinite` transformaria ausência em zero silencioso — uma multa
// "0%" no contrato em vez do padrão.
const num = (v: unknown, fallback: number): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v !== "string" || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const text = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim() ? v : fallback;

/**
 * Resolve os padrões da org sobre o padrão de fábrica — os DOIS branches.
 *
 * `contractDefaultsJson` é Json livre no banco, então tudo aqui é defensivo:
 * chave desconhecida ou tipo errado cai no default em vez de explodir a
 * geração de contrato.
 */
export function resolveOrgContractDefaults(contractDefaultsJson: unknown): {
  venda: ContractSettings;
  locacao: LocacaoSettings;
} {
  return {
    venda: resolveOrgVendaDefaults(contractDefaultsJson),
    locacao: resolveOrgLocacaoDefaults(contractDefaultsJson),
  };
}

/** Branch de locação de `contractDefaultsJson`, com fallback de fábrica. */
export function resolveOrgLocacaoDefaults(
  contractDefaultsJson: unknown
): LocacaoSettings {
  const locacao = obj(obj(contractDefaultsJson).locacao);
  const d = DEFAULT_LOCACAO_SETTINGS;
  const assinatura = obj(locacao.assinatura);
  const config = obj(locacao.config);

  return {
    foro: text(locacao.foro, d.foro),
    assinatura: {
      cidade: text(assinatura.cidade, d.assinatura.cidade),
      uf: text(assinatura.uf, d.assinatura.uf),
      data: text(assinatura.data, d.assinatura.data),
    },
    config: {
      multa_atraso_percent: num(
        config.multa_atraso_percent,
        d.config.multa_atraso_percent
      ),
      juros_mensais_atraso: num(
        config.juros_mensais_atraso,
        d.config.juros_mensais_atraso
      ),
      multa_rescisoria_meses: num(
        config.multa_rescisoria_meses,
        d.config.multa_rescisoria_meses
      ),
      honorarios_advocaticios_percent: num(
        config.honorarios_advocaticios_percent,
        d.config.honorarios_advocaticios_percent
      ),
    },
  };
}

/**
 * Branch comercial da locação. Mesmo tratamento defensivo dos outros: JSON livre
 * no banco, chave desconhecida cai no default em vez de explodir a criação do
 * formulário.
 */
export function resolveOrgLocacaoComissao(
  contractDefaultsJson: unknown
): LocacaoComissaoDefaults {
  const c = obj(obj(contractDefaultsJson).locacao_comissao);
  const d = DEFAULT_LOCACAO_COMISSAO;
  return {
    forma: c.forma === "valor_fixo" ? "valor_fixo" : d.forma,
    taxa_locacao_percent: num(c.taxa_locacao_percent, d.taxa_locacao_percent),
    taxa_locacao_valor: num(c.taxa_locacao_valor, d.taxa_locacao_valor),
  };
}

/** Branch de venda de `contractDefaultsJson`, com fallback de fábrica. */
export function resolveOrgVendaDefaults(
  contractDefaultsJson: unknown
): ContractSettings {
  const venda = obj(obj(contractDefaultsJson).venda);
  const d = DEFAULT_CONTRACT_SETTINGS;

  const desistencia = obj(venda.desistencia);
  const assinatura = obj(venda.assinatura);
  const config = obj(venda.config);
  const foro = venda.foro;

  return {
    desistencia: {
      permite:
        typeof desistencia.permite === "boolean"
          ? desistencia.permite
          : d.desistencia.permite,
      prazo_dias: num(desistencia.prazo_dias, d.desistencia.prazo_dias),
    },
    foro: foro === "arbitragem" || foro === "justica-publica" ? foro : d.foro,
    assinatura: {
      cidade: text(assinatura.cidade, d.assinatura.cidade),
      uf: text(assinatura.uf, d.assinatura.uf),
      data: text(assinatura.data, d.assinatura.data),
    },
    config: {
      multa_penal_moratoria: num(
        config.multa_penal_moratoria,
        d.config.multa_penal_moratoria
      ),
      base_calculo_multa: text(config.base_calculo_multa, d.config.base_calculo_multa),
      juros_mensais_atraso: num(
        config.juros_mensais_atraso,
        d.config.juros_mensais_atraso
      ),
      atualizacao_monetaria: text(
        config.atualizacao_monetaria,
        d.config.atualizacao_monetaria
      ),
      prazo_atraso_rescisao: num(
        config.prazo_atraso_rescisao,
        d.config.prazo_atraso_rescisao
      ),
      multa_cominatoria_diaria: num(
        config.multa_cominatoria_diaria,
        d.config.multa_cominatoria_diaria
      ),
      multa_penal_compensatoria: num(
        config.multa_penal_compensatoria,
        d.config.multa_penal_compensatoria
      ),
      prazo_multa_rescisoria: num(
        config.prazo_multa_rescisoria,
        d.config.prazo_multa_rescisoria
      ),
    },
  };
}

/**
 * Lê as configurações efetivas de um `dataJson` de contrato/form, caindo no
 * padrão (da org, ou de fábrica) pro que não estiver gravado.
 *
 * Usado pra pré-popular a aba Configurações: o painel abre mostrando o que o
 * contrato REALMENTE vai renderizar, não campos em branco.
 */
export function extractContractSettings(
  dataJson: unknown,
  defaults: ContractSettings = DEFAULT_CONTRACT_SETTINGS
): ContractSettings {
  const data = obj(dataJson);
  const desistencia = obj(data.desistencia);
  const assinatura = obj(data.assinatura);
  const config = obj(data.config);
  const foro = data.foro;

  return {
    desistencia: {
      permite:
        typeof desistencia.permite === "boolean"
          ? desistencia.permite
          : defaults.desistencia.permite,
      prazo_dias: num(desistencia.prazo_dias, defaults.desistencia.prazo_dias),
    },
    foro:
      foro === "arbitragem" || foro === "justica-publica" ? foro : defaults.foro,
    assinatura: {
      cidade: text(assinatura.cidade, defaults.assinatura.cidade),
      uf: text(assinatura.uf, defaults.assinatura.uf),
      data: text(assinatura.data, defaults.assinatura.data),
    },
    config: {
      multa_penal_moratoria: num(
        config.multa_penal_moratoria,
        defaults.config.multa_penal_moratoria
      ),
      base_calculo_multa: text(
        config.base_calculo_multa,
        defaults.config.base_calculo_multa
      ),
      juros_mensais_atraso: num(
        config.juros_mensais_atraso,
        defaults.config.juros_mensais_atraso
      ),
      atualizacao_monetaria: text(
        config.atualizacao_monetaria,
        defaults.config.atualizacao_monetaria
      ),
      prazo_atraso_rescisao: num(
        config.prazo_atraso_rescisao,
        defaults.config.prazo_atraso_rescisao
      ),
      multa_cominatoria_diaria: num(
        config.multa_cominatoria_diaria,
        defaults.config.multa_cominatoria_diaria
      ),
      multa_penal_compensatoria: num(
        config.multa_penal_compensatoria,
        defaults.config.multa_penal_compensatoria
      ),
      prazo_multa_rescisoria: num(
        config.prazo_multa_rescisoria,
        defaults.config.prazo_multa_rescisoria
      ),
    },
  };
}

/**
 * Converte as configurações num patch de `dataJson`.
 *
 * Grava os caminhos do form E as PONTES derivadas que `enrichContractData`
 * materializa (`config.desistencia_*`, `config.municipio_imovel`,
 * `config.data_assinatura`). Isso é essencial: o `Contract.dataJson` já está
 * enriquecido, e o enrich é idempotente ("não sobrescreve o que existe") — sem
 * gravar as pontes, mudar `assinatura.cidade` ou `desistencia.permite` NÃO
 * mudaria uma vírgula do texto renderizado.
 *
 * `municipio_imovel` só é sobrescrito quando há cidade explícita: em branco, o
 * enrich cai no município do imóvel, que é o comportamento desejado.
 */
export function buildSettingsPatch(s: ContractSettings): Record<string, unknown> {
  const municipio = [s.assinatura.cidade, s.assinatura.uf]
    .filter(Boolean)
    .join("/");

  const configPatch: Record<string, unknown> = {
    ...s.config,
    // Ponte desistência → template (`{{#if (eq config.desistencia_permite true)}}`).
    // `false` explícito, nunca null: `deepMergeAtPaths` ignora null/undefined e
    // um toggle-off silencioso deixaria a cláusula no contrato.
    desistencia_permite: s.desistencia.permite,
    ...(s.desistencia.permite
      ? { desistencia_prazo_dias: s.desistencia.prazo_dias }
      : {}),
    ...(municipio ? { municipio_imovel: municipio } : {}),
    ...(s.assinatura.data ? { data_assinatura: s.assinatura.data } : {}),
  };

  return {
    desistencia: s.desistencia,
    // Top-level de propósito: os templates v2 leem `foro`, não `config.foro`.
    foro: s.foro,
    assinatura: s.assinatura,
    config: configPatch,
  };
}

/**
 * Lê as configurações de LOCAÇÃO efetivas de um `dataJson`.
 *
 * `foro` aceita as duas origens que o form/enrich produzem: o top-level
 * (campo "Foro (comarca)" do formulário) e `config.foro_texto` (a ponte que o
 * enrich materializa e o template realmente imprime).
 */
export function extractLocacaoSettings(
  dataJson: unknown,
  defaults: LocacaoSettings = DEFAULT_LOCACAO_SETTINGS
): LocacaoSettings {
  const data = obj(dataJson);
  const assinatura = obj(data.assinatura);
  const config = obj(data.config);

  return {
    foro: text(data.foro, text(config.foro_texto, defaults.foro)),
    assinatura: {
      cidade: text(assinatura.cidade, defaults.assinatura.cidade),
      uf: text(assinatura.uf, defaults.assinatura.uf),
      data: text(assinatura.data, defaults.assinatura.data),
    },
    config: {
      multa_atraso_percent: num(
        config.multa_atraso_percent,
        defaults.config.multa_atraso_percent
      ),
      juros_mensais_atraso: num(
        config.juros_mensais_atraso,
        defaults.config.juros_mensais_atraso
      ),
      multa_rescisoria_meses: num(
        config.multa_rescisoria_meses,
        defaults.config.multa_rescisoria_meses
      ),
      honorarios_advocaticios_percent: num(
        config.honorarios_advocaticios_percent,
        defaults.config.honorarios_advocaticios_percent
      ),
    },
  };
}

/**
 * Patch de `dataJson` pra locação — mesma lógica de pontes do de venda.
 *
 * `config.foro_texto` é a ponte que o template imprime (`enrichLocacaoData` a
 * deriva de `foro`); sem gravá-la aqui, mudar a comarca não mexeria no texto,
 * porque o dataJson já vem enriquecido e o enrich não sobrescreve.
 * `foro_texto: ""` é gravado de propósito quando a comarca é apagada — o
 * template volta ao fallback "comarca de localização do imóvel" (string vazia
 * passa pelo `deepMergeAtPaths`, que só ignora null/undefined).
 */
export function buildLocacaoSettingsPatch(
  s: LocacaoSettings
): Record<string, unknown> {
  const municipio = [s.assinatura.cidade, s.assinatura.uf]
    .filter(Boolean)
    .join("/");

  const configPatch: Record<string, unknown> = {
    ...s.config,
    foro_texto: s.foro,
    ...(municipio ? { municipio_imovel: municipio } : {}),
    ...(s.assinatura.data ? { data_assinatura: s.assinatura.data } : {}),
  };

  return {
    foro: s.foro,
    assinatura: s.assinatura,
    config: configPatch,
  };
}
