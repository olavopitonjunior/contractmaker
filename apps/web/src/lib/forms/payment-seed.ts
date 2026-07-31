// Semeadura das parcelas do PagamentoStep (venda).
//
// Lógica PURA de propósito: a etapa em si é um componente client cheio de
// react-hook-form, e a regra de "quais parcelas abrir por modalidade / quando
// posso re-semear sem perguntar" precisa ser testável sem DOM.
//
// Contexto (2026-07-30): a lista de parcelas nascia VAZIA com um botão
// "Adicionar Parcela" embaixo — o usuário preenchia só o valor total e o
// contrato saía sem cronograma. A modalidade (`step5Schema.modalidade`) já
// existia no schema sem UI nenhuma. Agora o seletor de modalidade semeia as
// parcelas típicas de cada caminho, e `deriveCategoryFromPayment` (que continua
// sendo a autoridade da seleção de template) fica consistente POR CONSTRUÇÃO:
// a modalidade escolhida é a que produziu os `parcelas[].tipo`.

export const MODALIDADES = ["a_vista", "financiamento"] as const;
export type Modalidade = (typeof MODALIDADES)[number];

export const MODALIDADE_LABELS: Record<Modalidade, string> = {
  a_vista: "À vista",
  financiamento: "Financiamento",
};

/** Shape canônico de `pagamento.parcelas[]` (subset semeado). */
export interface ParcelaSeed {
  tipo_texto: string;
  dias: number;
  valor: number;
  tipo: string;
  momento: string;
}

/** Parcela como ela chega do form — tudo opcional (dataJson é livre). */
export interface ParcelaLike {
  tipo?: unknown;
  momento?: unknown;
  valor?: unknown;
  dias?: unknown;
  tipo_outros_texto?: unknown;
  permuta_descricao?: unknown;
  data_exata?: unknown;
  meio_pagamento?: unknown;
}

/**
 * Parcelas pré-abertas por modalidade.
 *
 * À vista: entrada/sinal na assinatura + o restante em recursos próprios na
 * escritura (o padrão do CCV à vista). Financiamento: entrada/sinal + a parcela
 * financiada na assinatura do contrato de financiamento (momento novo, com
 * prazo em dias inline).
 *
 * Valores nascem 0: quem preenche é o corretor, e o rodapé soma × total é o
 * guia de "as parcelas precisam fechar o valor".
 */
export function seedParcelas(modalidade: Modalidade): ParcelaSeed[] {
  const base = { tipo_texto: "", dias: 0, valor: 0 };
  if (modalidade === "financiamento") {
    return [
      { ...base, tipo: "sinal_arras", momento: "assinatura" },
      { ...base, tipo: "financiamento", momento: "contrato_financiamento" },
    ];
  }
  return [
    { ...base, tipo: "sinal_arras", momento: "assinatura" },
    { ...base, tipo: "recursos_proprios", momento: "escritura" },
  ];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const numOrZero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Rótulo visual da linha — NÃO muda o shape gravado. Deriva de tipo+momento
 * pra que a primeira linha diga "Entrada / Sinal" e a segunda "Escritura" ou
 * "Financiamento" em vez de "Parcela 1" / "Parcela 2".
 */
export function parcelaRowLabel(parcela: ParcelaLike, index: number): string {
  const tipo = str(parcela?.tipo);
  const momento = str(parcela?.momento);
  if (tipo === "sinal_arras") return "Entrada / Sinal";
  if (tipo === "financiamento") return "Financiamento";
  if (tipo === "recursos_proprios" && momento === "escritura") return "Escritura";
  if (tipo === "fgts") return "FGTS";
  return `Parcela ${index + 1}`;
}

/**
 * Modalidade implícita numa lista de parcelas já preenchida.
 *
 * Mesmo critério do `deriveCategoryFromPayment` (uma parcela financiada
 * classifica o negócio inteiro), replicado aqui porque aquele módulo puxa o
 * Prisma e este é importado pelo formulário público.
 */
export function deriveModalidadeFromParcelas(
  parcelas: readonly ParcelaLike[] | null | undefined,
  bancoFinanciamento?: unknown,
): Modalidade {
  const list = parcelas ?? [];
  if (list.some((p) => str(p?.tipo) === "financiamento")) return "financiamento";
  if (str(bancoFinanciamento)) return "financiamento";
  return "a_vista";
}

/** Alguém digitou alguma coisa nesta parcela? (valor, prazo ou texto livre) */
export function parcelaIsUntouched(parcela: ParcelaLike): boolean {
  return (
    numOrZero(parcela?.valor) === 0 &&
    numOrZero(parcela?.dias) === 0 &&
    !str(parcela?.tipo_outros_texto) &&
    !str(parcela?.permuta_descricao) &&
    !str(parcela?.data_exata) &&
    !str(parcela?.meio_pagamento)
  );
}

/**
 * A lista atual é exatamente a semeadura de `modalidade`, sem edição?
 *
 * É a condição de re-semear em SILÊNCIO ao trocar a modalidade. Qualquer
 * divergência (valor digitado, parcela extra, tipo trocado) devolve false e a
 * UI pergunta antes de descartar.
 */
export function parcelasMatchSeed(
  parcelas: readonly ParcelaLike[] | null | undefined,
  modalidade: Modalidade,
): boolean {
  const list = parcelas ?? [];
  const seed = seedParcelas(modalidade);
  if (list.length !== seed.length) return false;
  return list.every((p, i) => {
    if (!parcelaIsUntouched(p)) return false;
    return str(p?.tipo) === seed[i].tipo && str(p?.momento) === seed[i].momento;
  });
}

/**
 * Trocar a modalidade pode sobrescrever a lista sem perguntar?
 *
 * Sim quando não há nada a perder: lista vazia, linhas totalmente em branco
 * (sem tipo e sem valor) ou a semeadura intacta da modalidade anterior. Tipo
 * escolhido à mão conta como edição — aí a UI pergunta.
 */
export function canReseedSilently(
  parcelas: readonly ParcelaLike[] | null | undefined,
  modalidadeAtual: Modalidade,
): boolean {
  const list = parcelas ?? [];
  if (list.length === 0) return true;
  if (parcelasMatchSeed(list, modalidadeAtual)) return true;
  return list.every((p) => parcelaIsUntouched(p) && !str(p?.tipo));
}
