/**
 * Deriva um "Resumo da negociação" legível a partir do dataJson do form de
 * venda (DadosContratoForm). Pura: não chama rede nem DB. Usada na aba "Dados"
 * do DealDetail pra espelhar as tratativas (modalidade, pagamento, comissão e
 * condições) sem o operador ter que abrir o contrato.
 *
 * Lê apenas campos JÁ existentes no form — nenhum campo novo. Defensivo: todo
 * acesso é opcional, então funciona com forms parciais (OCR de CCV).
 */

export interface SummaryRow {
  label: string;
  value: string;
}

export interface SummarySection {
  title: string;
  rows: SummaryRow[];
}

function brl(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n === 0) return "";
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

const MODALIDADE_LABEL: Record<string, string> = {
  a_vista: "À vista",
  financiamento: "Financiamento",
};

type AnyObj = Record<string, unknown>;
const obj = (v: unknown): AnyObj => (v && typeof v === "object" ? (v as AnyObj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function buildNegotiationSummary(
  formData: Record<string, unknown> | null | undefined
): SummarySection[] {
  if (!formData) return [];
  const data = formData as AnyObj;
  const sections: SummarySection[] = [];

  // ---- Pagamento ----
  const pagamento = obj(data.pagamento);
  const pagRows: SummaryRow[] = [];
  const modalidade = str(data.modalidade);
  if (modalidade) {
    pagRows.push({
      label: "Modalidade",
      value: MODALIDADE_LABEL[modalidade] ?? modalidade,
    });
  }
  const pushMoney = (label: string, v: unknown) => {
    const f = brl(v);
    if (f) pagRows.push({ label, value: f });
  };
  pushMoney("Valor total", pagamento.valor_total);
  pushMoney("Sinal / arras", pagamento.sinal_arras ?? pagamento.sinal);
  pushMoney("Recursos próprios", pagamento.recursos_proprios);
  pushMoney("Financiamento", pagamento.alienacao_fiduciaria);
  pushMoney("FGTS", pagamento.fgts);
  pushMoney("Cessão de consórcio", pagamento.cessao_consorcio);
  pushMoney("Outras formas", pagamento.outras_formas);
  const parcelas = Array.isArray(pagamento.parcelas) ? pagamento.parcelas : [];
  if (parcelas.length > 0) {
    pagRows.push({ label: "Parcelas", value: `${parcelas.length} parcela(s)` });
  }
  const meioPagamento = str(pagamento.meio_pagamento);
  if (meioPagamento) pagRows.push({ label: "Meio de pagamento", value: meioPagamento });
  const bancoFin = str(pagamento.banco_financiamento);
  if (bancoFin) pagRows.push({ label: "Banco do financiamento", value: bancoFin });
  const saldoDevedor = brl(data.saldo_devedor);
  if (saldoDevedor) pagRows.push({ label: "Saldo devedor", value: saldoDevedor });
  if (pagRows.length > 0) sections.push({ title: "Pagamento", rows: pagRows });

  // ---- Comissão ----
  const comissao = obj(data.comissao);
  const comRows: SummaryRow[] = [];
  const comValor = brl(comissao.valor);
  if (comValor) comRows.push({ label: "Valor da comissão", value: comValor });
  const comPct = typeof comissao.percentual === "number" ? comissao.percentual : null;
  if (comPct) comRows.push({ label: "Percentual", value: `${comPct}%` });
  const quemPaga = str(comissao.quem_paga_texto) || str(comissao.quem_paga);
  if (quemPaga) comRows.push({ label: "Quem paga", value: quemPaga });
  const quandoPaga = str(comissao.quando_paga_texto) || str(comissao.quando_paga);
  if (quandoPaga) comRows.push({ label: "Quando", value: quandoPaga });
  const comissionados = Array.isArray(comissao.comissionados)
    ? comissao.comissionados
    : [];
  if (comissionados.length > 1) {
    comRows.push({
      label: "Comissionados",
      value: `${comissionados.length} envolvidos`,
    });
  }
  if (comRows.length > 0) sections.push({ title: "Comissão", rows: comRows });

  // ---- Condições ----
  const condRows: SummaryRow[] = [];
  const incluso = str(data.incluso_no_preco);
  if (incluso) condRows.push({ label: "Incluso no preço", value: incluso });

  const debitos = obj(data.debitos);
  const debParts: string[] = [];
  const iptu = obj(debitos.iptu);
  if (iptu.selecionado) debParts.push(`IPTU${brl(iptu.valor) ? ` (${brl(iptu.valor)})` : ""}`);
  const cond = obj(debitos.condominio);
  if (cond.selecionado)
    debParts.push(`Condomínio${brl(cond.valor) ? ` (${brl(cond.valor)})` : ""}`);
  if (str(debitos.outros)) debParts.push(str(debitos.outros));
  if (debParts.length > 0)
    condRows.push({ label: "Débitos", value: debParts.join("; ") });

  const debitosAssumidos = obj(data.debitos_assumidos);
  if (debitosAssumidos.assume) {
    condRows.push({
      label: "Débitos assumidos",
      value: str(debitosAssumidos.descricao) || "Sim",
    });
  }

  const vicios = obj(data.vicios);
  const vicioOpcao = str(vicios.opcao);
  if (vicioOpcao && vicioOpcao !== "renuncia") {
    const desc =
      str(vicios.descricao_reparar) || str(vicios.descricao_desocultados);
    condRows.push({ label: "Vícios", value: desc || vicioOpcao });
  }

  const regularizacoes = obj(data.regularizacoes);
  if (regularizacoes.tem) {
    condRows.push({
      label: "Regularizações",
      value: str(regularizacoes.descricao) || "Pendentes",
    });
  }

  const permuta = obj(data.permuta);
  if (str(permuta.descricao) || permuta.tem) {
    condRows.push({
      label: "Permuta",
      value: str(permuta.descricao) || "Sim",
    });
  }
  if (condRows.length > 0) sections.push({ title: "Condições", rows: condRows });

  return sections;
}
