import { formatMoneyBR } from "@/lib/format/money";
import { maskCPF, maskCNPJ } from "@/lib/forms/field-formats";
import { GARANTIA_LABELS, type GarantiaTipo } from "@/lib/contracts/template-category";

/**
 * Resumo leve do dataJson da proposta (proponente + imóvel + valor) sem expor o
 * JSON inteiro. Compartilhado entre a listagem (/pipeline/propostas) e o modo
 * `eligible` de GET /api/proposals (picker de conversão) — os dois precisam do
 * MESMO resumo, senão a mesma proposta aparece com rótulos diferentes.
 *
 * Client-safe (sem prisma), mas hoje só roda no servidor: `formatMoneyBR` é
 * determinístico (sem ICU) justamente pra sair pronto do server component.
 */
export function summarizeProposalData(
  dataJson: unknown,
  kind?: string
): {
  proponente: string | null;
  imovel: string | null;
  valorLabel: string | null;
  negocio: string | null;
} {
  const d = (dataJson ?? {}) as Record<string, unknown>;
  const imoveis = d.imoveis as Array<{ endereco?: string; numero?: string }> | undefined;
  const im = imoveis?.[0];
  const imovel = im?.endereco
    ? `${im.endereco}${im.numero ? `, ${im.numero}` : ""}`
    : null;
  // Proponente = 1º comprador (venda) ou 1º locatário (locação).
  const partes = (d.compradores ?? d.locatarios) as Array<{ nome?: string }> | undefined;
  const proponente = partes?.[0]?.nome?.trim() || null;
  const pag = d.pagamento as { valor_total?: number } | undefined;
  const loc = d.locacao as
    | { valor_aluguel?: number; prazo_meses?: number; garantia?: string }
    | undefined;
  const valor = pag?.valor_total ?? loc?.valor_aluguel ?? null;

  // Chip de negócio por tipo (só com `kind`): venda = modalidade; locação =
  // garantia + prazo. O aluguel já é a coluna Valor.
  let negocio: string | null = null;
  if (kind === "venda") {
    const modalidade = d.modalidade;
    negocio =
      modalidade === "financiamento"
        ? "Financiamento"
        : modalidade === "a_vista"
          ? "À vista"
          : null;
  } else if (kind === "locacao") {
    const garantiaObj = d.garantia as { tipo?: string } | undefined;
    const garantiaLabel =
      loc?.garantia ??
      (garantiaObj?.tipo
        ? GARANTIA_LABELS[garantiaObj.tipo as GarantiaTipo] ?? garantiaObj.tipo
        : null);
    const prazo =
      typeof loc?.prazo_meses === "number" && loc.prazo_meses > 0
        ? `${loc.prazo_meses}m`
        : null;
    negocio = [garantiaLabel, prazo].filter(Boolean).join(" · ") || null;
  }

  return {
    proponente,
    imovel,
    valorLabel: typeof valor === "number" ? formatMoneyBR(valor, { decimals: 0 }) : null,
    negocio,
  };
}

export interface ProposalDetailRow {
  label: string;
  value: string;
}

export interface ProposalPartyLine {
  nome: string;
  /** CPF/CNPJ mascarado, ou null quando o documento não foi informado. */
  doc: string | null;
  /** "email · telefone" — o que houver. */
  contato: string | null;
}

export interface ProposalDetails {
  proponentes: ProposalPartyLine[];
  /** Vendedores (venda) ou locadores (locação). */
  vendedores: ProposalPartyLine[];
  /** Condições do negócio, já rotuladas e formatadas (modalidade/sinal ou prazo/garantia...). */
  condicoes: ProposalDetailRow[];
  comissao: ProposalDetailRow[];
  /** "Nome (CRECI 12345)" ou null. */
  corretorLabel: string | null;
  observacoes: string | null;
}

function partyLine(raw: unknown): ProposalPartyLine | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const nome = str(p.razao_social) || str(p.nome);
  if (!nome) return null;
  const cnpj = str(p.cnpj);
  const cpf = str(p.cpf);
  const doc = cnpj
    ? `CNPJ ${maskCNPJ(cnpj)}`
    : cpf
      ? `CPF ${maskCPF(cpf)}`
      : null;
  const contato =
    [str(p.email), str(p.telefone)].filter(Boolean).join(" · ") || null;
  return { nome, doc, contato };
}

/**
 * Detalhamento do dataJson pro grid da tela de detalhe: partes completas,
 * condições do negócio, comissão e corretor — tudo já rotulado/formatado no
 * servidor (mesma regra anti-hydration do `summarizeProposalData`: nenhuma
 * formatação de moeda/data pode rodar no client).
 */
export function summarizeProposalDetails(
  dataJson: unknown,
  kind?: string
): ProposalDetails {
  const d = (dataJson ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const lines = (v: unknown) =>
    (Array.isArray(v) ? v : []).map(partyLine).filter(Boolean) as ProposalPartyLine[];

  const isVenda = kind !== "locacao";
  const proponentes = lines(isVenda ? d.compradores : d.locatarios);
  const vendedores = lines(isVenda ? d.vendedores : d.locadores);

  const condicoes: ProposalDetailRow[] = [];
  if (isVenda) {
    const pag = (d.pagamento ?? {}) as Record<string, unknown>;
    // `pagamento.forma` já sai humano do buildProposalDataJson ("Financiamento
    // bancário (Itaú)"); modalidade crua é o fallback de propostas antigas.
    const forma =
      str(pag.forma) ||
      (d.modalidade === "financiamento"
        ? "Financiamento bancário"
        : d.modalidade === "a_vista"
          ? "À vista"
          : "");
    if (forma) condicoes.push({ label: "Modalidade", value: forma });
    const sinal = num(pag.sinal_arras) ?? num(pag.sinal);
    if (sinal != null && sinal > 0) {
      condicoes.push({ label: "Sinal", value: formatMoneyBR(sinal) });
    }
  } else {
    const loc = (d.locacao ?? {}) as Record<string, unknown>;
    const garantiaObj = (d.garantia ?? {}) as Record<string, unknown>;
    const prazo = num(loc.prazo_meses);
    if (prazo != null && prazo > 0) {
      condicoes.push({ label: "Prazo", value: `${prazo} meses` });
    }
    const entrada = str(loc.data_entrada);
    if (entrada) {
      // dataEntrada é <input type="date"> (YYYY-MM-DD) — reordena sem ICU.
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entrada);
      condicoes.push({
        label: "Entrada",
        value: m ? `${m[3]}/${m[2]}/${m[1]}` : entrada,
      });
    }
    const finalidade = str(loc.finalidade);
    if (finalidade) condicoes.push({ label: "Finalidade", value: finalidade });
    const garantia =
      str(loc.garantia) ||
      (str(garantiaObj.tipo)
        ? GARANTIA_LABELS[garantiaObj.tipo as GarantiaTipo] ?? str(garantiaObj.tipo)
        : "");
    if (garantia) condicoes.push({ label: "Garantia", value: garantia });
  }

  const comissao: ProposalDetailRow[] = [];
  const com = (d.comissao ?? {}) as Record<string, unknown>;
  const pct = num(com.percentual);
  if (pct != null && pct > 0) {
    comissao.push({
      label: "Percentual",
      value: `${String(pct).replace(".", ",")}%`,
    });
  }
  const comValor = num(com.valor);
  if (comValor != null && comValor > 0) {
    comissao.push({ label: "Valor", value: formatMoneyBR(comValor) });
  }
  const resp = str(com.responsavel_pagamento);
  if (resp) {
    comissao.push({
      label: "Quem paga",
      value: resp.charAt(0).toUpperCase() + resp.slice(1),
    });
  }

  const corretor = (d.corretor ?? {}) as Record<string, unknown>;
  const corretorNome = str(corretor.nome);
  const corretorCreci = str(corretor.creci);
  const corretorLabel = corretorNome
    ? corretorCreci
      ? `${corretorNome} (CRECI ${corretorCreci})`
      : corretorNome
    : corretorCreci
      ? `CRECI ${corretorCreci}`
      : null;

  return {
    proponentes,
    vendedores,
    condicoes,
    comissao,
    corretorLabel,
    observacoes: str(d.observacoes) || null,
  };
}
