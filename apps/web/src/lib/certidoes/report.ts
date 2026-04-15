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
  resultCode: number | null;
  resultData: unknown;
  errorMessage: string | null;
  retryCount: number;
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

// Same "trust resultData over status" logic used in the UI. The report PDF
// must reflect the real state of the data, not the job row.
function effectiveStatus(
  status: string,
  resultCode: number | null,
  r: NormalizedResult | null
): string {
  if ((status === "fetching" || status === "pending") && r && resultCode === 200) {
    const s = r.situacao;
    if (
      s === "negativa" ||
      s === "positiva" ||
      s === "positiva_com_efeitos" ||
      s === "nao_emitida" ||
      s === "aguardando_pdf"
    ) {
      return "success";
    }
  }
  return status;
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
    case "aguardando_pdf":
      return "Negativa (aguardando PDF)";
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
  let aguardandoPdf = 0;
  let falhas = 0;
  let puladas = 0;
  const latencies: number[] = [];
  let totalCostCents = 0;
  const pendencias: string[] = [];
  const falhasDetalhadas: Array<{
    label: string;
    motivo: string;
    retryCount: number;
  }> = [];
  const puladasDetalhadas: Array<{ label: string; motivo: string }> = [];

  for (const job of input.jobs) {
    const r = (job.resultData as NormalizedResult | null) ?? null;
    const effStatus = effectiveStatus(job.status, job.resultCode, r);
    const key =
      job.targetKind === "imovel"
        ? `imovel-${job.targetIndex}`
        : `${job.targetKind}-${job.targetIndex}`;
    const bucket = grouped.get(key);
    const row = {
      label: job.label,
      statusKey: statusKey(effStatus, r),
      statusTexto: statusText(effStatus, r),
      validade: r?.validade ?? "—",
      detalhes: r?.detalhes ?? (effStatus === "failed" ? "falha na chamada" : "—"),
    };
    if (bucket) bucket.jobs.push(row);

    if (effStatus === "failed") {
      falhas++;
      const motivo = job.errorMessage || "falha na chamada — retentar";
      pendencias.push(`${job.label}: ${motivo}`);
      falhasDetalhadas.push({
        label: job.label,
        motivo,
        retryCount: job.retryCount,
      });
    } else if (effStatus === "skipped") {
      puladas++;
      puladasDetalhadas.push({
        label: job.label,
        motivo: job.errorMessage || "dados insuficientes",
      });
    } else if (r?.situacao === "negativa") {
      sucessoNegativa++;
    } else if (r?.situacao === "aguardando_pdf") {
      aguardandoPdf++;
      sucessoNegativa++; // Ainda conta como sucesso: negativa confirmada
    } else if (r?.situacao === "positiva" || r?.situacao === "positiva_com_efeitos") {
      positivas++;
      pendencias.push(`${job.label}: ${r.detalhes ?? "consta débito"}`);
    }

    if (job.latencyMs != null && job.latencyMs > 0) {
      latencies.push(job.latencyMs);
    }
    if (job.costCents != null) totalCostCents += job.costCents;
  }

  // Median latency with outlier filter (>3x median) — same logic as UI
  let latenciaSegundos = 0;
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    const filtered = sorted.filter((v) => v <= median * 3);
    const avg =
      filtered.length > 0
        ? filtered.reduce((a, b) => a + b, 0) / filtered.length
        : median;
    latenciaSegundos = Math.round(avg / 1000);
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
    aguardandoPdf,
    falhas,
    puladas,
    custoReais: (totalCostCents / 100).toFixed(2),
    latenciaSegundos,
    partes,
    imoveis,
    pendencias,
    falhasDetalhadas,
    puladasDetalhadas,
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
