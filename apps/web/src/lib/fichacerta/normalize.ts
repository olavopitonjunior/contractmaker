/**
 * Normalizer do laudo Ficha Certa → `NormalizedResult` (o mesmo contrato que
 * Infosimples e Serasa entregam ao executor/UI).
 *
 * Regra de situação (decidida no plano, 04/09/2026):
 *   - qualquer bloco de RESTRIÇÃO com `icon: "negativo"` (restrições
 *     financeiras — protestos/pendências/ações/cheques —, situação do CPF,
 *     suspeita de óbito) → `com_restricao`;
 *   - todos esses blocos `positivo`/`neutro` → `sem_restricao`;
 *   - nenhum deles presente/só `nulo` → `indeterminado`.
 * Compatibilidade de renda NÃO muda a situação (é parecer, não restrição) —
 * vai em `detalhes` e em `raw`, e o card mostra o parecer da locação.
 *
 * Tudo opcional: a doc é um Postman sem schema. Shape estranho cai em
 * `indeterminado` com `detalhes` dizendo por quê — nunca em "negativa".
 */

import type { NormalizedResult } from "@/lib/certidoes/types";
import type { Laudo, LaudoBlock, LaudoIcon, ReportPretendente } from "./types";

const RESTRICAO_BLOCKS: ReadonlyArray<keyof Laudo & string> = [
  "restricoes_financeiras",
  "situacao_cpf",
  "suspeita_obito",
];

function iconOf(block: unknown): LaudoIcon | null {
  const icon = (block as LaudoBlock | undefined)?.icon;
  return icon === "positivo" || icon === "neutro" || icon === "negativo" || icon === "nulo"
    ? icon
    : null;
}

export interface FichaCertaSummary {
  scoreFc: number | null;
  parecer: string | null;
  recomendacoes: string[];
  rendaVezes: number | null;
  restricoesInfo: Record<string, string>;
  icons: Record<string, LaudoIcon>;
  produtos: Array<{ id?: number; nome?: string; status?: string; data_atualizacao?: string }>;
  dataConclusao: string | null;
}

export function summarizeLaudo(pret: ReportPretendente): FichaCertaSummary {
  const laudo = (pret.laudo ?? {}) as Laudo;
  const parecerSistemico = Array.isArray(laudo.parecer_sistemico) ? laudo.parecer_sistemico[0] : undefined;
  const score = parecerSistemico?.score_fc;
  const renda = laudo.compatibilidade_renda?.result?.vezes;
  const icons: Record<string, LaudoIcon> = {};
  for (const [k, v] of Object.entries(laudo)) {
    const icon = iconOf(v);
    if (icon) icons[k] = icon;
  }
  const restricoesInfo: Record<string, string> = {};
  const rf = laudo.restricoes_financeiras?.result;
  if (rf && typeof rf === "object") {
    for (const [k, v] of Object.entries(rf)) {
      if (v && typeof v === "object" && typeof (v as { info?: unknown }).info === "string") {
        restricoesInfo[k] = (v as { info: string }).info;
      }
    }
  }
  return {
    scoreFc: typeof score === "number" && Number.isFinite(score) ? score : null,
    parecer: typeof parecerSistemico?.parecer === "string" ? parecerSistemico.parecer : null,
    recomendacoes: Array.isArray(parecerSistemico?.recomendacao)
      ? parecerSistemico.recomendacao.filter((r): r is string => typeof r === "string")
      : [],
    rendaVezes: typeof renda === "number" && Number.isFinite(renda) ? renda : null,
    restricoesInfo,
    icons,
    produtos: Array.isArray(pret.pessoa?.produtos)
      ? pret.pessoa.produtos.map((p) => ({
          id: p.id,
          nome: p.nome,
          status: p.status,
          data_atualizacao: p.data_atualizacao,
        }))
      : [],
    dataConclusao: typeof laudo.data_conclusao === "string" ? laudo.data_conclusao : null,
  };
}

export function normalizeFichaCertaLaudo(pret: ReportPretendente): NormalizedResult {
  const laudo = pret.laudo;
  const summary = summarizeLaudo(pret);
  if (!laudo || typeof laudo !== "object") {
    return {
      situacao: "indeterminado",
      detalhes: "Laudo ainda não disponível para este pretendente.",
      raw: summary,
    };
  }

  const icons = RESTRICAO_BLOCKS.map((k) => iconOf(laudo[k])).filter((i): i is LaudoIcon => i !== null);
  const informative = icons.filter((i) => i !== "nulo");
  let situacao: NormalizedResult["situacao"];
  if (informative.length === 0) situacao = "indeterminado";
  else if (informative.includes("negativo")) situacao = "com_restricao";
  else situacao = "sem_restricao";

  const partes: string[] = [];
  if (summary.scoreFc != null) partes.push(`Score FC ${summary.scoreFc}`);
  if (summary.parecer) partes.push(summary.parecer);
  if (summary.rendaVezes != null) partes.push(`renda ${summary.rendaVezes.toFixed(1)}x o aluguel`);
  if (situacao === "com_restricao") {
    const negativos = Object.entries(summary.restricoesInfo)
      .filter(([, info]) => info && info.toUpperCase() !== "NADA CONSTA")
      .map(([k]) => k);
    if (negativos.length > 0) partes.push(`restrições: ${negativos.join(", ")}`);
  }
  if (situacao === "indeterminado") partes.push("laudo sem blocos de restrição reconhecíveis");

  return {
    situacao,
    emissao: summary.dataConclusao ?? undefined,
    detalhes: partes.join(" · ") || null,
    raw: summary,
  };
}

/** Todos os produtos do pretendente em CONCLUIDO (laudo pronto). */
export function isPretendenteConcluido(pret: ReportPretendente): boolean {
  const produtos = pret.pessoa?.produtos;
  if (!Array.isArray(produtos) || produtos.length === 0) return false;
  return produtos.every((p) => p.status === "CONCLUIDO");
}

/** Algum produto ainda em fila/andamento. */
export function isPretendenteEmAndamento(pret: ReportPretendente): boolean {
  const produtos = pret.pessoa?.produtos;
  if (!Array.isArray(produtos) || produtos.length === 0) return true;
  return produtos.some((p) => p.status === "INCLUIDO" || p.status === "SOLICITADO" || p.status === "ANDAMENTO" || p.status === "REINCLUIDO");
}

/**
 * Chave de idempotência do webhook/reconciliação: (solicitação, pretendente,
 * última atualização de produto). O mesmo laudo reentregue produz a mesma
 * chave; um reprocessamento (data_atualizacao nova) produz outra.
 */
export function pretendenteUpdateKey(
  solicitationId: number | string,
  pret: ReportPretendente
): string {
  const pid = pret.pessoa?.id ?? "?";
  const datas = (pret.pessoa?.produtos ?? [])
    .map((p) => p.data_atualizacao ?? p.data ?? "")
    .filter(Boolean)
    .sort();
  const last = datas[datas.length - 1] ?? pret.laudo?.data_conclusao ?? "";
  return `${solicitationId}:${pid}:${last}`;
}
