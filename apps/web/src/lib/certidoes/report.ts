import fs from "fs";
import path from "path";
import Handlebars from "handlebars";
import type { NormalizedResult } from "./types";

interface JobForReport {
  id: string;
  label: string;
  endpoint: string;
  targetKind: string;
  targetIndex: number;
  status: string;
  resultData: unknown;
  latencyMs: number | null;
  costCents: number | null;
}

interface BuildInput {
  dealTitle: string;
  responsavel: string;
  partes: Array<{ label: string; key: string }>;
  imoveis: Array<{ label: string; key: string }>;
  jobs: JobForReport[];
}

function statusKey(status: string, r: NormalizedResult | null): string {
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  if (status === "awaiting_portal") return "aguardando";
  if (!r) return "indeterminado";
  return r.situacao;
}

function statusText(status: string, r: NormalizedResult | null): string {
  if (status === "failed") return "Erro";
  if (status === "skipped") return "Pulado";
  if (status === "awaiting_portal") return "Aguardando portal";
  if (!r) return "—";
  switch (r.situacao) {
    case "negativa":
      return "Negativa";
    case "positiva":
      return "Positiva";
    case "positiva_com_efeitos":
      return "Positiva c/ efeitos";
    case "nao_emitida":
      return "Não emitida";
    default:
      return "Indeterminado";
  }
}

export function buildReportData(input: BuildInput): Record<string, unknown> {
  const grouped = new Map<
    string,
    { label: string; kind: string; jobs: Array<Record<string, unknown>> }
  >();
  input.partes.forEach((p) =>
    grouped.set(p.key, { label: p.label, kind: "parte", jobs: [] })
  );
  input.imoveis.forEach((i) =>
    grouped.set(i.key, { label: i.label, kind: "imovel", jobs: [] })
  );

  let sucessoNegativa = 0;
  let positivas = 0;
  let falhas = 0;
  let puladas = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  let totalCostCents = 0;
  const pendencias: string[] = [];

  for (const job of input.jobs) {
    const r = (job.resultData as NormalizedResult | null) ?? null;
    const key =
      job.targetKind === "imovel"
        ? `imovel-${job.targetIndex}`
        : `${job.targetKind}-${job.targetIndex}`;
    const bucket = grouped.get(key);
    const row = {
      label: job.label,
      statusKey: statusKey(job.status, r),
      statusTexto: statusText(job.status, r),
      validade: r?.validade ?? "—",
      detalhes: r?.detalhes ?? (job.status === "failed" ? "falha na chamada" : "—"),
    };
    if (bucket) bucket.jobs.push(row);

    if (job.status === "failed") {
      falhas++;
      pendencias.push(`${job.label}: falha na extração, retentar`);
    } else if (job.status === "skipped") {
      puladas++;
    } else if (r?.situacao === "negativa") {
      sucessoNegativa++;
    } else if (r?.situacao === "positiva" || r?.situacao === "positiva_com_efeitos") {
      positivas++;
      pendencias.push(`${job.label}: ${r.detalhes ?? "consta débito"}`);
    }

    if (job.latencyMs != null) {
      totalLatency += job.latencyMs;
      latencyCount++;
    }
    if (job.costCents != null) totalCostCents += job.costCents;
  }

  const partes = input.partes
    .map((p) => grouped.get(p.key))
    .filter((g): g is NonNullable<typeof g> => !!g && g.jobs.length > 0);
  const imoveis = input.imoveis
    .map((i) => grouped.get(i.key))
    .filter((g): g is NonNullable<typeof g> => !!g && g.jobs.length > 0);

  return {
    deal: { title: input.dealTitle },
    responsavel: input.responsavel,
    dataEmissao: new Date().toLocaleDateString("pt-BR"),
    total: input.jobs.length,
    sucessoNegativa,
    positivas,
    falhas,
    puladas,
    custoReais: (totalCostCents / 100).toFixed(2),
    latenciaSegundos: latencyCount > 0 ? Math.round(totalLatency / latencyCount / 1000) : 0,
    partes,
    imoveis,
    pendencias,
  };
}

export function renderReportHtml(data: Record<string, unknown>): string {
  const templatePath = path.join(
    process.cwd(),
    "..",
    "..",
    "templates",
    "relatorio_certidoes.hbs"
  );
  let source: string;
  try {
    source = fs.readFileSync(templatePath, "utf-8");
  } catch {
    // Fallback for different CWDs
    const alt = path.join(process.cwd(), "templates", "relatorio_certidoes.hbs");
    source = fs.readFileSync(alt, "utf-8");
  }
  const template = Handlebars.compile(source, { noEscape: true });
  return template(data);
}
