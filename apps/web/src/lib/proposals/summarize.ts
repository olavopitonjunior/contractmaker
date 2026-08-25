import { formatMoneyBR } from "@/lib/format/money";
import { maskCPF, maskCNPJ } from "@/lib/forms/field-formats";
import { GARANTIA_LABELS, normalizeGarantiaTipo } from "@/lib/contracts/template-category";

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
  // Proponente = 1º comprador (venda) ou 1º locatário (locação). Com `kind`
  // conhecido a lista certa é escolhida por ele — o `??` sozinho deixava um
  // `compradores: []` legado numa locação esconder os locatários preenchidos.
  const partes = partesRaw(d, kind).proponentes as
    | Array<{ nome?: string }>
    | undefined;
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
    const prazo =
      typeof loc?.prazo_meses === "number" && loc.prazo_meses > 0
        ? `${loc.prazo_meses}m`
        : null;
    negocio = [garantiaLabel(d), prazo].filter(Boolean).join(" · ") || null;
  }

  return {
    proponente,
    imovel,
    valorLabel: typeof valor === "number" ? formatMoneyBR(valor, { decimals: 0 }) : null,
    negocio,
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Número do dataJson: aceita number E string numérica. O dataJson é
 * `z.record(z.unknown())` gravado verbatim — proposta criada por API/agente
 * (Max tem escrita em /api/proposals) chega com `percentual: "6"`, e exigir
 * `typeof number` derrubava a linha em silêncio.
 */
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

/**
 * Listas de partes por papel, com o MESMO dispatch nos dois resumos (chip da
 * listagem e detalhe): kind conhecido escolhe a lista certa; sem kind, o
 * fallback `??` cobre dataJson legado. Divergir os dois fazia a mesma proposta
 * mostrar partes diferentes conforme o caminho.
 */
function partesRaw(
  d: Record<string, unknown>,
  kind?: string
): { proponentes: unknown; vendedores: unknown } {
  return {
    proponentes:
      kind === "venda"
        ? d.compradores
        : kind === "locacao"
          ? d.locatarios
          : (d.compradores ?? d.locatarios),
    vendedores:
      kind === "venda"
        ? d.vendedores
        : kind === "locacao"
          ? d.locadores
          : (d.vendedores ?? d.locadores),
  };
}

/**
 * Label humano da garantia: `locacao.garantia` (string pronta do
 * buildProposalDataJson) vence; fallback pro shape canônico `garantia.tipo`
 * via GARANTIA_LABELS. Compartilhado entre o chip da listagem e o detalhe —
 * duas cópias divergiriam exatamente como o summarize() local divergiu.
 */
function garantiaLabel(d: Record<string, unknown>): string | null {
  const loc = (d.locacao ?? {}) as Record<string, unknown>;
  const garantiaObj = (d.garantia ?? {}) as Record<string, unknown>;
  const tipo = str(garantiaObj.tipo);
  const canonico = normalizeGarantiaTipo(tipo);
  return (
    str(loc.garantia) ||
    (canonico ? GARANTIA_LABELS[canonico] : tipo || null) ||
    null
  );
}

/**
 * `comissao.responsavel_pagamento` guarda FRAGMENTOS de frase do template ("o
 * proponente comprador", "a parte vendedora" — valores do Select do
 * ProposalForm, impressos no documento). Como valor de card eles precisam de
 * rótulo próprio; capitalizar o fragmento cru dava "O proponente comprador".
 */
const RESPONSAVEL_PAGAMENTO_LABELS: Record<string, string> = {
  "o proponente comprador": "Proponente comprador",
  "o proponente locatário": "Proponente locatário",
  "a parte vendedora": "Parte vendedora",
  "a parte locadora": "Parte locadora",
  "ambas as partes": "Ambas as partes",
};

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
  const nome = str(p.razao_social) || str(p.nome);
  if (!nome) return null;
  // Rótulo/máscara pelo TAMANHO, não pelo campo: `partyToData` grava qualquer
  // documento de parte não-PJ em `cpf` (e o caminho MCP idem) — um CNPJ de 14
  // dígitos ali passaria por maskCPF, que trunca em 11 e fabrica um CPF
  // plausível e ERRADO na tela de onde o corretor copia números.
  const docDigits = (str(p.cnpj) || str(p.cpf)).replace(/\D/g, "");
  const doc =
    docDigits.length === 14
      ? `CNPJ ${maskCNPJ(docDigits)}`
      : docDigits.length === 11
        ? `CPF ${maskCPF(docDigits)}`
        : docDigits
          ? `Doc. ${docDigits}`
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
  const lines = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map(partyLine)
      .filter((l): l is ProposalPartyLine => l !== null);

  const isVenda = kind !== "locacao";
  const partes = partesRaw(d, kind);
  const proponentes = lines(partes.proponentes);
  const vendedores = lines(partes.vendedores);

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
    const garantia = garantiaLabel(d);
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
      value: RESPONSAVEL_PAGAMENTO_LABELS[resp] ?? resp.charAt(0).toUpperCase() + resp.slice(1),
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
