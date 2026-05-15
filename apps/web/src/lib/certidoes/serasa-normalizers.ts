/**
 * Normalizers Serasa Experian — traduzem a resposta JSON crua em
 * `NormalizedResult` consumido pelo executor/UI igual aos demais providers.
 *
 * Por que separado dos normalizers Infosimples:
 *   - Os shapes Infosimples são totalmente diferentes (estrutura por endpoint,
 *     com `site_receipts[]` + `data[]`). Misturar normalize geraria branches
 *     gigantes no normalizers.ts. Mantemos provider-specific.
 *
 * Por que campos optional em tudo:
 *   - Serasa renomeia/move campos sem aviso prévio (mesma armadilha que
 *     Infosimples). Os normalizers absorvem o ruído; testes regressivos com
 *     fixtures garantem que mudanças quebrem rápido.
 */

import type {
  SerasaScoreResponse,
  SerasaRestritivosResponse,
  SerasaVinculosResponse,
} from "@/lib/serasa/types";
import type { NormalizedResult } from "./types";

function pickNumber(...candidates: Array<unknown>): number | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim() !== "") {
      const n = Number(c.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function classifyScoreRisk(score: number): string {
  if (score >= 700) return "baixo";
  if (score >= 500) return "medio";
  if (score >= 300) return "alto";
  return "muito alto";
}

function brl(cents: number): string {
  return cents.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Normaliza resposta de Score (PF ou PJ).
 *
 * Situação canônica: `informativa` — score por si não é "negativa"/"positiva".
 * O risco vem do número (campo `score` 0-1000) e é exposto via `detalhes`.
 */
export function normalizeScore(resp: SerasaScoreResponse): NormalizedResult {
  const score = pickNumber(resp.score, (resp as Record<string, unknown>).pontuacao);
  if (typeof score !== "number") {
    return {
      situacao: "indeterminado",
      detalhes: "Resposta sem campo score reconhecivel — verifique fixture.",
      raw: resp,
    };
  }
  const faixa =
    (resp.faixa as string) ??
    (resp.classificacao as string) ??
    classifyScoreRisk(score);
  return {
    situacao: "informativa",
    detalhes: `Score ${score}/1000 — risco ${faixa}.`,
    raw: {
      score,
      faixa,
      classificacao: resp.classificacao,
      motivos: resp.motivosScore,
      protocolo: resp.consultaProtocolo,
      dataConsulta: resp.dataConsulta,
    },
  };
}

/**
 * Normaliza resposta de Restritivos.
 *
 * Situação canônica:
 *   - `sem_restricao` quando totalOcorrencias === 0 (ou todas as listas vazias).
 *   - `com_restricao` quando há pelo menos uma ocorrência.
 *
 * Não usar `negativa`/`positiva` aqui — esses ficam reservados pro léxico
 * Infosimples (onde "positiva" = COM débito, anti-intuitivo).
 */
export function normalizeRestritivos(resp: SerasaRestritivosResponse): NormalizedResult {
  const counts: Record<string, number> = {
    pendencias: resp.pendencias?.length ?? 0,
    protestos: resp.protestos?.length ?? 0,
    acoes: resp.acoes?.length ?? 0,
    cheques: resp.chequesSemFundo?.length ?? 0,
  };
  const total =
    resp.totalOcorrencias ??
    counts.pendencias + counts.protestos + counts.acoes + counts.cheques;
  const valor =
    resp.valorTotal ??
    [
      ...(resp.pendencias ?? []),
      ...(resp.protestos ?? []),
      ...(resp.acoes ?? []),
      ...(resp.chequesSemFundo ?? []),
    ].reduce<number>((acc, item) => acc + (typeof item.valor === "number" ? item.valor : 0), 0);

  if (total === 0) {
    return {
      situacao: "sem_restricao",
      detalhes: "Nenhuma pendencia, protesto ou acao localizada.",
      raw: {
        protocolo: resp.consultaProtocolo,
        totalOcorrencias: 0,
        valorTotal: 0,
        counts,
        pendencias: [],
        protestos: [],
        acoes: [],
        chequesSemFundo: [],
      },
    };
  }

  // Resumo legível pro detalhes (3 maiores categorias)
  const parts: string[] = [];
  if (counts.protestos) parts.push(`${counts.protestos} protesto${counts.protestos > 1 ? "s" : ""}`);
  if (counts.pendencias)
    parts.push(`${counts.pendencias} pendencia${counts.pendencias > 1 ? "s" : ""}`);
  if (counts.acoes) parts.push(`${counts.acoes} acao${counts.acoes > 1 ? "es" : ""}`);
  if (counts.cheques) parts.push(`${counts.cheques} cheque${counts.cheques > 1 ? "s" : ""}`);

  const valorTxt = valor > 0 ? `, total ${brl(valor)}` : "";
  return {
    situacao: "com_restricao",
    detalhes: `${total} ocorrencia${total > 1 ? "s" : ""}${valorTxt}: ${parts.join(" + ")}.`,
    raw: {
      protocolo: resp.consultaProtocolo,
      totalOcorrencias: total,
      valorTotal: valor,
      counts,
      pendencias: resp.pendencias ?? [],
      protestos: resp.protestos ?? [],
      acoes: resp.acoes ?? [],
      chequesSemFundo: resp.chequesSemFundo ?? [],
    },
  };
}

/**
 * Normaliza resposta de Vínculos PJ↔PF.
 *
 * Situação canônica: `informativa` — vínculos não são "negativa"/"positiva".
 * O `raw.vinculos` carrega a lista que a UI usa pra montar o multi-select
 * de "Adicionar como diligenciado".
 */
export function normalizeVinculos(resp: SerasaVinculosResponse): NormalizedResult {
  const vinculos = resp.vinculos ?? [];
  const total = resp.totalVinculos ?? vinculos.length;
  return {
    situacao: "informativa",
    detalhes:
      total === 0
        ? "Nenhum vinculo societario localizado."
        : `${total} vinculo${total > 1 ? "s" : ""} societario${total > 1 ? "s" : ""} localizado${
            total > 1 ? "s" : ""
          }.`,
    raw: {
      protocolo: resp.consultaProtocolo,
      totalVinculos: total,
      vinculos,
    },
  };
}

/**
 * Dispatcher por endpointId. Mantém o executor enxuto: ele só pergunta
 * "normalizeSerasa(endpoint, body)" sem precisar saber qual normalizer rodar.
 */
export function normalizeSerasa(
  endpoint: string,
  body: unknown
): NormalizedResult {
  if (endpoint.startsWith("serasa/score-")) {
    return normalizeScore(body as SerasaScoreResponse);
  }
  if (endpoint.startsWith("serasa/restritivos-")) {
    return normalizeRestritivos(body as SerasaRestritivosResponse);
  }
  if (endpoint.startsWith("serasa/vinculos-")) {
    return normalizeVinculos(body as SerasaVinculosResponse);
  }
  return {
    situacao: "indeterminado",
    detalhes: `Endpoint Serasa desconhecido: ${endpoint}`,
    raw: body,
  };
}
