import { notFound } from "next/navigation";
import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getTimeline } from "@/lib/ai/multi-agent-memory";

export const dynamic = "force-dynamic";

const OUTCOME_LABEL: Record<string, string> = {
  applied: "Aplicado",
  applied_partial: "Aplicado parcial",
  pending_plan: "Pendente (aprovação)",
  no_op_informational: "Consulta",
  failed: "Falhou",
  confabulation_blocked: "Confabulação bloqueada",
};

type ToolCall = { name?: string; success?: boolean; applied?: boolean };

export default async function AIRunDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) notFound();
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const run = await prisma.agentRun.findFirst({
    where: { id: params.id, orgId: org.id },
  });
  if (!run) notFound();

  // Timeline mais ampla do contrato (audit + usage + change logs) pra contexto.
  const timeline = run.contractId
    ? await getTimeline(run.contractId, { sessionId: run.sessionId ?? undefined, limit: 40 })
    : [];

  const tools = (run.toolCallsJson as ToolCall[] | null) ?? [];
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(d);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href="/settings/ai-runs" className="text-sm text-violet-600 hover:underline">
        ← Execuções de IA
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Run {run.id.slice(-8)}</h1>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
        <Field label="Resultado" value={OUTCOME_LABEL[run.outcome] ?? run.outcome} />
        <Field label="Modo" value={run.mode} />
        <Field label="Intent" value={run.intent ?? "—"} />
        <Field label="Quando" value={fmt(run.createdAt)} />
        <Field label="Agentes" value={run.agentsRun.join(", ") || "—"} />
        <Field label="Writes (ap/pend/falha)" value={`${run.writesApplied}/${run.writesPending}/${run.writesFailed}`} />
        <Field label="Tokens" value={String(run.totalTokens)} />
        <Field label="Latência" value={`${run.latencyMs} ms`} />
      </div>

      {run.contractId && (
        <Link
          href={`/contracts/${run.contractId}`}
          className="mt-3 inline-block text-sm text-violet-600 hover:underline"
        >
          Abrir contrato →
        </Link>
      )}

      <Section title="Ferramentas executadas">
        {tools.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma tool de escrita.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {tools.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={t.success ? "text-green-600" : "text-red-600"}>{t.success ? "✓" : "✗"}</span>
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{t.name}</code>
                {t.applied === true && <span className="text-xs text-green-700">aplicado</span>}
                {t.applied === false && <span className="text-xs text-amber-700">não confirmado</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Resposta do agente">
        <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
          {run.finalMessagePreview ?? "—"}
        </pre>
      </Section>

      <Section title="Timeline do contrato (contexto)">
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-400">Sem eventos.</p>
        ) : (
          <ul className="space-y-1 text-xs text-gray-600">
            {timeline.slice(0, 30).map((e) => (
              <li key={e.id}>
                <span className="text-gray-400">{fmt(e.at)}</span> · <span className="font-medium">{e.kind}</span>
                {e.agent ? ` · ${e.agent}` : ""} — {e.summary}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 font-medium text-gray-900">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </div>
  );
}
