import { notFound } from "next/navigation";
import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const OUTCOME_STYLE: Record<string, { label: string; cls: string }> = {
  applied: { label: "Aplicado", cls: "bg-green-100 text-green-800" },
  applied_partial: { label: "Aplicado parcial", cls: "bg-amber-100 text-amber-800" },
  pending_plan: { label: "Pendente (aprovação)", cls: "bg-blue-100 text-blue-800" },
  no_op_informational: { label: "Consulta", cls: "bg-gray-100 text-gray-700" },
  failed: { label: "Falhou", cls: "bg-red-100 text-red-800" },
  confabulation_blocked: { label: "Confabulação bloqueada", cls: "bg-purple-100 text-purple-800" },
};

type SearchParams = { outcome?: string };

export default async function AIRunsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) notFound();
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const outcomeFilter = searchParams?.outcome;

  const [runs, grouped] = await Promise.all([
    prisma.agentRun.findMany({
      where: { orgId: org.id, ...(outcomeFilter ? { outcome: outcomeFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.agentRun.groupBy({
      by: ["outcome"],
      where: { orgId: org.id },
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries(grouped.map((g) => [g.outcome, g._count._all]));
  const total = grouped.reduce((s, g) => s + g._count._all, 0);
  const applied = (counts.applied ?? 0) + (counts.applied_partial ?? 0);
  const appliedPct = total > 0 ? Math.round((applied / total) * 100) : 0;
  const confab = counts.confabulation_blocked ?? 0;
  const failed = counts.failed ?? 0;

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-1 font-display text-2xl font-semibold tracking-tight">Execuções de IA (AgentRun)</div>
      <p className="mb-6 text-sm text-gray-500">
        Log determinístico de cada turn do chat — o que foi efetivamente aplicado ao documento,
        para análise de funcionamento, output e treino dos agentes.
      </p>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total de turns" value={String(total)} />
        <Kpi label="% aplicados" value={`${appliedPct}%`} />
        <Kpi label="Confabulações bloqueadas" value={String(confab)} highlight={confab > 0} />
        <Kpi label="Falhas" value={String(failed)} highlight={failed > 0} />
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <FilterLink current={outcomeFilter} value={undefined} label={`Todos (${total})`} />
        {Object.entries(OUTCOME_STYLE).map(([k, v]) => (
          <FilterLink key={k} current={outcomeFilter} value={k} label={`${v.label} (${counts[k] ?? 0})`} />
        ))}
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Modo</th>
              <th className="px-3 py-2">Intent</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2">Writes (ap/pend/falha)</th>
              <th className="px-3 py-2">Agentes</th>
              <th className="px-3 py-2">Resposta (prévia)</th>
              <th className="px-3 py-2">Contrato</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  Nenhuma execução registrada ainda.
                </td>
              </tr>
            )}
            {runs.map((r) => {
              const st = OUTCOME_STYLE[r.outcome] ?? { label: r.outcome, cls: "bg-gray-100 text-gray-700" };
              return (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-2">{r.mode}</td>
                  <td className="px-3 py-2 text-gray-600">{r.intent ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {r.writesApplied}/{r.writesPending}/{r.writesFailed}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.agentsRun.join(", ") || "—"}</td>
                  <td className="max-w-sm px-3 py-2 text-xs text-gray-600">
                    {(r.finalMessagePreview ?? "").replace(/\n+/g, " ").slice(0, 160)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/settings/ai-runs/${r.id}`} className="text-violet-600 hover:underline">
                      detalhe
                    </Link>
                    {r.contractId ? (
                      <>
                        {" · "}
                        <Link href={`/contracts/${r.contractId}`} className="text-violet-600 hover:underline">
                          contrato
                        </Link>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${highlight ? "text-red-700" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function FilterLink({
  current,
  value,
  label,
}: {
  current?: string;
  value?: string;
  label: string;
}) {
  const active = current === value || (!current && !value);
  const href = value ? `/settings/ai-runs?outcome=${value}` : "/settings/ai-runs";
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 ${
        active ? "border-violet-300 bg-violet-50 text-violet-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
    </Link>
  );
}
