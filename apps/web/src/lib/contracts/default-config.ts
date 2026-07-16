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
 * corromperia uma das duas — por isso a coluna nasce namespaced por módulo,
 * mesmo com só o branch de venda implementado.
 */

export const contractSettingsSchema = z.object({
  desistencia: z.object({
    permite: z.boolean().default(false),
    prazo_dias: z.number().int().min(1).max(365).default(7),
  }),
  foro: z.enum(["arbitragem", "justica-publica"]),
  assinatura: z.object({
    cidade: z.string().max(120).default(""),
    uf: z.string().max(2).default(""),
    // "" = usar a data em que o contrato for assinado (o template cai no
    // fallback do enrich); senão ISO yyyy-mm-dd.
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser AAAA-MM-DD")
      .or(z.literal(""))
      .default(""),
  }),
  config: z.object({
    multa_penal_moratoria: z.number().min(0).max(100).default(2),
    base_calculo_multa: z.string().max(200).default("valor da parcela"),
    juros_mensais_atraso: z.number().min(0).max(100).default(1),
    atualizacao_monetaria: z.string().max(100).default("IPCA"),
    prazo_atraso_rescisao: z.number().int().min(1).max(365).default(10),
    multa_cominatoria_diaria: z.number().min(0).default(150),
    multa_penal_compensatoria: z.number().min(0).max(100).default(10),
    prazo_multa_rescisoria: z.number().int().min(1).max(365).default(7),
  }),
});

export type ContractSettings = z.infer<typeof contractSettingsSchema>;

/**
 * Padrão de fábrica. São os mesmos literais que viviam hardcoded em
 * `SalesFormWizard.defaultFormValues` — manter em sincronia importa: forms
 * antigos gravaram exatamente estes valores no dataJson.
 */
export const DEFAULT_CONTRACT_SETTINGS: ContractSettings = {
  desistencia: { permite: false, prazo_dias: 7 },
  foro: "arbitragem",
  assinatura: { cidade: "", uf: "", data: "" },
  config: {
    multa_penal_moratoria: 2,
    base_calculo_multa: "valor da parcela",
    juros_mensais_atraso: 1,
    atualizacao_monetaria: "IPCA",
    prazo_atraso_rescisao: 10,
    multa_cominatoria_diaria: 150,
    multa_penal_compensatoria: 10,
    prazo_multa_rescisoria: 7,
  },
};

/** Shape de `OrgFormSettings.contractDefaultsJson`. */
export const orgContractDefaultsSchema = z.object({
  venda: contractSettingsSchema.deepPartial().optional(),
  // Reservado — locação tem semântica própria de `foro`/`config` (ver topo).
  locacao: z.record(z.unknown()).optional(),
});

export type OrgContractDefaults = z.infer<typeof orgContractDefaultsSchema>;

type AnyObj = Record<string, unknown>;
const obj = (v: unknown): AnyObj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as AnyObj) : {};

/**
 * Resolve o padrão de venda da org sobre o padrão de fábrica.
 *
 * `contractDefaultsJson` é Json livre no banco, então tudo aqui é defensivo:
 * chave desconhecida ou tipo errado cai no default em vez de explodir a
 * geração de contrato.
 */
export function resolveOrgContractDefaults(
  contractDefaultsJson: unknown
): ContractSettings {
  const venda = obj(obj(contractDefaultsJson).venda);
  const d = DEFAULT_CONTRACT_SETTINGS;

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
