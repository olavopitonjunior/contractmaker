// Relatório semanal do revisor pós-geração — módulo PURO (agregação + e-mail).
//
// A feature nasceu ON para todos os tenants com cap de custo; este relatório é
// o instrumento de OBSERVAÇÃO: os super-admins recebem toda semana o que o
// revisor fez (runs, achados, descartes do guardrail, custo por org) sem
// ninguém precisar consultar o banco. As três perguntas que ele responde:
// o guardrail está segurando alucinação? os achados estão sendo resolvidos ou
// ignorados (ruído)? algum tenant está encostando no cap?
//
// A rota (api/cron/contract-review/weekly-report) busca as linhas; aqui só
// entra dado já carregado — testável sem banco.

export interface WeeklyRunRow {
  status: string;
  orgId: string;
  /** ContractReviewRun.report cru (Json do banco). */
  report: unknown;
}

export interface WeeklyCommentRow {
  severity: string;
  resolved: boolean;
}

export interface WeeklyCostRow {
  orgId: string;
  costUsd: number;
  calls: number;
}

export interface WeeklyReviewMetrics {
  since: Date;
  until: Date;
  runs: { total: number; done: number; failed: number; skipped: number };
  /** Motivos de skip agregados (feature-disabled, daily-cap…). */
  skipReasons: Record<string, number>;
  llm: {
    /** Achados aceitos, por categoria. */
    findingsByCategory: Record<string, number>;
    /** Descartados pelo guardrail — o termômetro de alucinação. */
    discarded: number;
    /** Chamadas que precisaram do 2º degrau da escada. */
    retried: number;
  };
  comments: { created: number; resolved: number; bySeverity: Record<string, number> };
  cost: {
    totalUsd: number;
    byOrg: Array<{ orgId: string; orgName: string; costUsd: number; calls: number }>;
  };
}

export function buildWeeklyReviewMetrics(input: {
  since: Date;
  until: Date;
  runs: readonly WeeklyRunRow[];
  comments: readonly WeeklyCommentRow[];
  costs: readonly WeeklyCostRow[];
  orgNames: ReadonlyMap<string, string>;
}): WeeklyReviewMetrics {
  const runs = { total: input.runs.length, done: 0, failed: 0, skipped: 0 };
  const skipReasons: Record<string, number> = {};
  const findingsByCategory: Record<string, number> = {};
  let discarded = 0;
  let retried = 0;

  for (const run of input.runs) {
    if (run.status === "done") runs.done += 1;
    else if (run.status === "failed") runs.failed += 1;
    else if (run.status === "skipped") runs.skipped += 1;

    // Leitura defensiva do report — Json de runs antigos/futuros não derruba
    // o relatório; o que não parsear simplesmente não conta.
    const report = run.report as {
      reason?: unknown;
      llm?: {
        findings?: Array<{ category?: unknown }>;
        discarded?: unknown;
        retried?: unknown;
        skipped?: unknown;
      };
    } | null;
    if (run.status === "skipped" && typeof report?.reason === "string") {
      skipReasons[report.reason] = (skipReasons[report.reason] ?? 0) + 1;
    }
    const llm = report?.llm;
    if (llm && typeof llm === "object") {
      if (typeof llm.skipped === "string") {
        skipReasons[`llm:${llm.skipped}`] = (skipReasons[`llm:${llm.skipped}`] ?? 0) + 1;
      }
      for (const f of Array.isArray(llm.findings) ? llm.findings : []) {
        const cat = typeof f?.category === "string" ? f.category : "desconhecida";
        findingsByCategory[cat] = (findingsByCategory[cat] ?? 0) + 1;
      }
      if (typeof llm.discarded === "number" && Number.isFinite(llm.discarded)) {
        discarded += llm.discarded;
      }
      if (llm.retried === true) retried += 1;
    }
  }

  const bySeverity: Record<string, number> = {};
  let resolved = 0;
  for (const c of input.comments) {
    bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;
    if (c.resolved) resolved += 1;
  }

  const byOrg = [...input.costs]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10)
    .map((c) => ({
      orgId: c.orgId,
      orgName: input.orgNames.get(c.orgId) ?? c.orgId,
      costUsd: c.costUsd,
      calls: c.calls,
    }));

  return {
    since: input.since,
    until: input.until,
    runs,
    skipReasons,
    llm: { findingsByCategory, discarded, retried },
    comments: { created: input.comments.length, resolved, bySeverity },
    cost: {
      totalUsd: input.costs.reduce((sum, c) => sum + c.costUsd, 0),
      byOrg,
    },
  };
}

const fmtUsd = (v: number) => `US$ ${v.toFixed(2)}`;
const fmtDate = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

export function renderWeeklyReviewEmail(m: WeeklyReviewMetrics): {
  subject: string;
  text: string;
} {
  const periodo = `${fmtDate(m.since)}–${fmtDate(m.until)}`;
  const lines: string[] = [
    `Revisor pós-geração — semana ${periodo}`,
    "",
    `Runs: ${m.runs.total} (done ${m.runs.done} · failed ${m.runs.failed} · skipped ${m.runs.skipped})`,
  ];
  const skips = Object.entries(m.skipReasons);
  if (skips.length > 0) {
    lines.push(`Skips: ${skips.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  }
  lines.push("");
  const cats = Object.entries(m.llm.findingsByCategory).sort((a, b) => b[1] - a[1]);
  lines.push(
    `Achados LLM: ${cats.reduce((s, [, v]) => s + v, 0)}` +
      (cats.length ? ` (${cats.map(([k, v]) => `${k}=${v}`).join(" · ")})` : "")
  );
  lines.push(
    `Guardrail: ${m.llm.discarded} descartado(s) [termômetro de alucinação] · ${m.llm.retried} retry(s) de escada`
  );
  lines.push("");
  lines.push(
    `Comentários criados: ${m.comments.created} (${Object.entries(m.comments.bySeverity)
      .map(([k, v]) => `${k}=${v}`)
      .join(" · ") || "—"}) · resolvidos na janela: ${m.comments.resolved}`
  );
  lines.push("");
  lines.push(`Custo total: ${fmtUsd(m.cost.totalUsd)}`);
  for (const org of m.cost.byOrg) {
    lines.push(`  · ${org.orgName}: ${fmtUsd(org.costUsd)} em ${org.calls} chamada(s)`);
  }
  if (m.runs.total === 0) {
    lines.push("");
    lines.push(
      "Nenhum run na semana — se houve geração de contratos, o pipeline de revisão pode estar quebrado (conferir cron e enqueue)."
    );
  }
  return {
    subject: `[Contractmaker] Revisor pós-geração — semana ${periodo}`,
    text: lines.join("\n"),
  };
}
