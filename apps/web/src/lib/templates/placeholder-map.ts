import { flattenForPlaceholders } from "@/lib/google/replace-placeholders";
import {
  qualificacaoPessoas,
  qualificacaoPessoasVenda,
  qualificacaoFiador,
  clausulaGarantia,
  blocoAdministradora,
  blocoAssinaturas,
  parcelasPagamento,
  hbsExpr,
} from "./composed-blocks";

// ============================================================================
// Mapa de placeholders pra geração engine="google_docs": campos simples
// formatados + blocos compostos (loops/condicionais resolvidos server-side).
// O spread de flattenForPlaceholders mantém compat com docs antigos que usam
// tokens flat (`vendedor_nome` etc.). Recebe o dataJson JÁ enriquecido
// (enrichLocacaoData / enrichContractData).
// ============================================================================

const INDICE_TEXTO: Record<string, string> = {
  IGPM: "Índice Geral de Preços - Mercado (IGP-M)",
  IPCA: "Índice Nacional de Preços ao Consumidor Amplo (IPCA)",
};

function get(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
    data
  );
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function numExtensoPar(data: Record<string, unknown>, path: string): string {
  const v = get(data, path);
  if (v == null || v === "" || Number.isNaN(Number(v))) return "";
  return `${v} (${hbsExpr(`numeroExtenso ${path}`, data)})`;
}

function enderecoCompleto(imovel: Record<string, unknown> | undefined): string {
  if (!imovel) return "";
  const partes: string[] = [];
  if (imovel.rua) partes.push(`${imovel.rua}, nº ${str(imovel.numero)}`);
  if (imovel.complemento) partes.push(str(imovel.complemento));
  if (imovel.bairro) partes.push(str(imovel.bairro));
  if (imovel.cep) partes.push(`CEP ${hbsExpr("cep imovel.cep", { imovel })}`);
  if (imovel.cidade) partes.push(`${imovel.cidade}/${str(imovel.uf)}`);
  return partes.join(", ");
}

function dataLocalAssinatura(data: Record<string, unknown>): string {
  const config = (data.config ?? {}) as Record<string, unknown>;
  const municipio = str(config.municipio_imovel);
  const dataTxt = config.data_assinatura
    ? hbsExpr("dataExtenso config.data_assinatura", data)
    : "";
  return [municipio, dataTxt].filter(Boolean).join(", ");
}

export function buildLocacaoPlaceholderMap(
  enriched: Record<string, unknown>
): Record<string, string> {
  const config = (enriched.config ?? {}) as Record<string, unknown>;
  const imovel = enriched.imovel as Record<string, unknown> | undefined;
  const garantia = (enriched.garantia ?? {}) as Record<string, unknown>;

  const map: Record<string, string> = {
    ...flattenForPlaceholders(enriched),

    // Compostos
    locadores_qualificacao: qualificacaoPessoas((enriched.locadores as unknown[]) ?? []),
    locatarios_qualificacao: qualificacaoPessoas((enriched.locatarios as unknown[]) ?? []),
    fiador_qualificacao: qualificacaoFiador(enriched),
    clausula_garantia: clausulaGarantia(enriched),
    bloco_administradora: blocoAdministradora(enriched),
    assinaturas: blocoAssinaturas(enriched),

    // Simples formatados
    imovel_endereco_completo: enderecoCompleto(imovel),
    imovel_descricao: str(imovel?.descricao),
    imovel_matricula: imovel?.matricula
      ? `${imovel.matricula}${imovel.cartorio ? ` do ${imovel.cartorio}` : ""}`
      : "",
    imovel_inscricao_iptu: str(imovel?.inscricao_iptu),
    aluguel_valor: get(enriched, "aluguel.valor") != null ? hbsExpr("moeda aluguel.valor", enriched) : "",
    aluguel_valor_extenso:
      get(enriched, "aluguel.valor") != null ? hbsExpr("extenso aluguel.valor", enriched) : "",
    aluguel_dia_vencimento: numExtensoPar(enriched, "aluguel.dia_vencimento"),
    vigencia_meses: numExtensoPar(enriched, "aluguel.vigencia_meses"),
    vigencia_inicio: str(config.vigencia_inicio_texto),
    vigencia_fim: str(config.vigencia_fim_texto),
    indice_reajuste_texto:
      INDICE_TEXTO[str(get(enriched, "aluguel.indice_reajuste"))] ??
      "índice ajustado entre as partes",
    multa_atraso_percent:
      config.multa_atraso_percent != null
        ? `${config.multa_atraso_percent}% (${hbsExpr("numeroExtenso config.multa_atraso_percent", enriched)} por cento)`
        : "",
    juros_mensais_atraso:
      config.juros_mensais_atraso != null
        ? `${config.juros_mensais_atraso}% (${hbsExpr("numeroExtenso config.juros_mensais_atraso", enriched)} por cento)`
        : "",
    multa_rescisoria_meses: numExtensoPar(enriched, "config.multa_rescisoria_meses"),
    foro_texto: str(config.foro_texto) || "localização do imóvel",
    data_local_assinatura: dataLocalAssinatura(enriched),
    garantia_provider: str(garantia.provider),
    // Administração/despesas do form (2026-08) — textos prontos do enrich; a
    // engine google_docs é flat, então as condicionais viram string vazia.
    encargos_repasse_texto: str(config.encargos_repasse_texto),
    contas_no_condominio_texto: str(config.contas_no_condominio_texto),
    taxa_admin_percent:
      config.taxa_admin_percent != null
        ? `${config.taxa_admin_percent}% (${hbsExpr("numeroExtenso config.taxa_admin_percent", enriched)} por cento)`
        : "",
  };

  return map;
}

export function buildVendaPlaceholderMap(
  enriched: Record<string, unknown>
): Record<string, string> {
  const imoveis = (enriched.imoveis as Record<string, unknown>[]) ?? [];
  const imovel = imoveis[0];
  const pagamento = (enriched.pagamento ?? {}) as Record<string, unknown>;
  const comissao = (enriched.comissao ?? {}) as Record<string, unknown>;

  const map: Record<string, string> = {
    ...flattenForPlaceholders(enriched),

    // Compostos
    vendedores_qualificacao: qualificacaoPessoasVenda(
      (enriched.vendedores as unknown[]) ?? []
    ),
    compradores_qualificacao: qualificacaoPessoasVenda(
      (enriched.compradores as unknown[]) ?? []
    ),
    parcelas_pagamento: parcelasPagamento(enriched),

    // Simples formatados
    imovel_endereco_completo: enderecoCompleto(imovel),
    imovel_descricao: str(imovel?.descricao),
    imovel_matricula: imovel?.matricula
      ? `${imovel.matricula}${imovel.cartorio ? ` do ${imovel.cartorio}` : ""}`
      : "",
    imovel_inscricao_iptu: str(imovel?.inscricao_iptu),
    preco_total:
      pagamento.valor_total != null ? hbsExpr("moeda pagamento.valor_total", enriched) : "",
    preco_total_extenso:
      pagamento.valor_total != null ? hbsExpr("extenso pagamento.valor_total", enriched) : "",
    sinal_valor:
      pagamento.sinal_arras != null ? hbsExpr("moeda pagamento.sinal_arras", enriched) : "",
    comissao_valor: comissao.valor != null ? hbsExpr("moeda comissao.valor", enriched) : "",
    foro_texto: str((enriched.config as Record<string, unknown> | undefined)?.foro_texto),
    data_local_assinatura: dataLocalAssinatura(enriched),
  };

  return map;
}
