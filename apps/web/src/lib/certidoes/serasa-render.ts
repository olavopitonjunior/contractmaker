/**
 * Renderiza HTML pro PDF da consulta Serasa. Caller passa o resultado já
 * normalizado + contexto do consultado; aqui só compilamos Handlebars.
 *
 * Por que template separado de `relatorio_certidoes.hbs`:
 *   - Aquele é um sumário do batch (todas as certidões num PDF). Este é
 *     PDF individual por consulta, incluindo gauge de score, tabelas de
 *     restritivos e lista de vínculos.
 *
 * Limitação: helpers Handlebars são registrados globalmente. Reusamos os
 * mesmos de `lib/render/handlebars.ts` (formatBRL e similares) — se ainda
 * não estiverem registrados quando este arquivo é importado, registramos
 * um helper local mínimo no `compileTemplate`.
 */

import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import type { NormalizedResult, TargetKind } from "./types";

let _compiledTemplate: HandlebarsTemplateDelegate<unknown> | null = null;

function ensureHelpers(): void {
  if (!Handlebars.helpers.formatBRL) {
    Handlebars.registerHelper("formatBRL", (value: unknown) => {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return "—";
      return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    });
  }
}

function loadTemplate(): HandlebarsTemplateDelegate<unknown> {
  if (_compiledTemplate) return _compiledTemplate;
  ensureHelpers();
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", "serasa_report.hbs"),
    path.join(process.cwd(), "templates", "serasa_report.hbs"),
  ];
  let source: string | null = null;
  for (const p of candidates) {
    try {
      source = fs.readFileSync(p, "utf-8");
      break;
    } catch {
      continue;
    }
  }
  if (!source) {
    throw new Error(
      `Template Serasa nao encontrado. Procurei em: ${candidates.join(" e ")}`
    );
  }
  _compiledTemplate = Handlebars.compile(source, { noEscape: true });
  return _compiledTemplate;
}

export interface SerasaRenderContext {
  endpoint: string;
  label: string;
  consultado: {
    tipo: "Pessoa fisica" | "Pessoa juridica";
    label: string;
    documento: string;
    uf?: string;
    kind: TargetKind;
    index: number;
  };
}

function riscoClass(faixa: string | undefined): string {
  const f = (faixa ?? "").toLowerCase();
  if (f.includes("baixo")) return "green";
  if (f.includes("med")) return "amber";
  if (f.includes("alto") || f.includes("muito")) return "red";
  return "slate";
}

function situacaoLabel(s: NormalizedResult["situacao"]): { label: string; cls: string } {
  if (s === "sem_restricao") return { label: "Sem restricoes", cls: "green" };
  if (s === "com_restricao") return { label: "Com restricoes", cls: "red" };
  if (s === "informativa") return { label: "Informativo", cls: "slate" };
  return { label: String(s), cls: "slate" };
}

export function renderSerasaHtml(
  normalized: NormalizedResult,
  ctx: SerasaRenderContext
): string {
  const template = loadTemplate();
  const isScore = ctx.endpoint.startsWith("serasa/score-");
  const isRestritivos = ctx.endpoint.startsWith("serasa/restritivos-");
  const isVinculos = ctx.endpoint.startsWith("serasa/vinculos-");
  const raw = normalized.raw as Record<string, unknown> | undefined;
  const sit = situacaoLabel(normalized.situacao);

  return template({
    titulo: ctx.label,
    dataEmissao: new Date().toLocaleString("pt-BR"),
    protocolo: raw?.protocolo,
    detalhes: normalized.detalhes,
    consultado: ctx.consultado,
    isScore,
    isRestritivos,
    isVinculos,
    score: isScore ? raw : null,
    riscoClass: isScore ? riscoClass((raw?.faixa as string) ?? undefined) : "slate",
    restritivos: isRestritivos ? raw : null,
    situacaoLabel: sit.label,
    situacaoClass: sit.cls,
    vinculos: isVinculos ? (raw?.vinculos as unknown[]) : null,
    raw: JSON.stringify(normalized.raw ?? {}, null, 2),
  });
}
