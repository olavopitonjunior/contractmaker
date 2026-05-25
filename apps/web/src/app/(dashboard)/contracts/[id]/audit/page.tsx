import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getOrchestratorGraph } from "@/lib/ai/orchestrator/graph";
import type { ToolCallRecord } from "@/lib/ai/orchestrator/state";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
  searchParams: { sessionId?: string };
}

interface AuditEntry {
  checkpointId: string;
  createdAt: string | null;
  step: number | null;
  nextNodes: string[];
  intent: string | null;
  userMessage: string | null;
  finalMessage: string | null;
  agentsUsed: string[];
  toolCalls: Array<{ name: string; success: boolean; agent: string }>;
}

async function loadAudit(contractId: string, sessionId: string): Promise<AuditEntry[]> {
  const graph = getOrchestratorGraph();
  const entries: AuditEntry[] = [];
  try {
    for await (const snapshot of graph.getStateHistory({
      configurable: { thread_id: sessionId },
    })) {
      const values = snapshot.values as Record<string, unknown>;
      const config = snapshot.config as { configurable?: { checkpoint_id?: string } };
      const metadata = (snapshot as { metadata?: { step?: number } }).metadata;
      const specialistOutputs =
        (values.specialistOutputs as Record<string, { toolCalls?: ToolCallRecord[] }>) ?? {};
      const agentsUsed = Object.keys(specialistOutputs);
      const toolCalls: AuditEntry["toolCalls"] = [];
      for (const [agent, out] of Object.entries(specialistOutputs)) {
        for (const tc of out.toolCalls ?? []) {
          toolCalls.push({ name: tc.name, success: tc.success, agent });
        }
      }
      entries.push({
        checkpointId: config.configurable?.checkpoint_id ?? "",
        createdAt: (snapshot as { createdAt?: string }).createdAt ?? null,
        step: metadata?.step ?? null,
        nextNodes: Array.isArray(snapshot.next) ? (snapshot.next as string[]) : [],
        intent: (values.intent as string) ?? null,
        userMessage: (values.userMessage as string) ?? null,
        finalMessage: (values.finalMessage as string) ?? null,
        agentsUsed,
        toolCalls,
      });
    }
  } catch (err) {
    console.error("[audit page] getStateHistory falhou:", err);
  }
  // Mais recente primeiro
  return entries.reverse();
}

export default async function ContractAuditPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) return null;

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      deal: { select: { id: true, title: true } },
    },
  });
  if (!contract) notFound();

  // Resolve session
  let sessionId = searchParams.sessionId;
  let sessions = await prisma.chatSession.findMany({
    where: { contractId: params.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, archived: true, updatedAt: true },
  });
  if (!sessionId && sessions.length > 0) {
    sessionId = sessions[0].id;
  }

  const entries = sessionId ? await loadAudit(params.id, sessionId) : [];

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <div className="mb-6">
        <Link
          href={`/contracts/${params.id}`}
          className="text-sm text-violet-600 hover:underline"
        >
          ← Voltar ao contrato
        </Link>
        <h1 className="font-display tracking-tight text-2xl font-bold mt-2">Auditoria de IA — Time travel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cada turn do orchestrator multi-agente foi salvo como checkpoint no
          PostgresSaver. Use isto pra investigar o que aconteceu, replay debug
          ou exportar evidência forense.
        </p>
        {contract.deal && (
          <p className="text-xs text-muted-foreground mt-1">
            Deal: <span className="font-mono">{contract.deal.title}</span> ·
            Contrato: <span className="font-mono">{params.id}</span>
          </p>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border bg-amber-50 border-amber-200 p-4 text-amber-900">
          Nenhuma session de chat encontrada para este contrato.
        </div>
      ) : (
        <div className="mb-6">
          <label className="text-sm font-medium block mb-1">Session:</label>
          <div className="flex flex-wrap gap-2">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/contracts/${params.id}/audit?sessionId=${s.id}`}
                className={`px-3 py-1 rounded-full border text-xs ${
                  s.id === sessionId
                    ? "bg-violet-100 border-violet-400 text-violet-900"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {s.title || s.id.slice(0, 8)}
                {s.archived && <span className="ml-1 text-gray-400">(arq)</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {sessionId && entries.length === 0 && (
        <div className="rounded-lg border bg-amber-50 border-amber-200 p-4 text-amber-900">
          Nenhum checkpoint encontrado pra esta session.
          <p className="text-xs mt-1">
            Possíveis causas: session criada antes de F3, ou{" "}
            <code>ENABLE_MULTI_AGENT</code> nunca ficou true.
          </p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-4">
          {entries.map((e, idx) => (
            <div key={e.checkpointId || idx} className="rounded-lg border p-4 bg-white">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground font-mono">
                  step {e.step ?? "?"} · {e.createdAt ? new Date(e.createdAt).toLocaleString("pt-BR") : "?"}
                </div>
                {e.intent && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-violet-100 text-violet-900 font-medium">
                    intent: {e.intent}
                  </span>
                )}
              </div>

              {e.userMessage && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-gray-500 mb-1">User</div>
                  <div className="text-sm text-gray-800 bg-gray-50 rounded px-3 py-2">
                    {e.userMessage}
                  </div>
                </div>
              )}

              {e.agentsUsed.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {e.agentsUsed.map((a) => (
                    <span
                      key={a}
                      className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-900"
                    >
                      🤖 {a}
                    </span>
                  ))}
                </div>
              )}

              {e.toolCalls.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    Tool calls ({e.toolCalls.length})
                  </div>
                  <div className="space-y-0.5">
                    {e.toolCalls.map((tc, i) => (
                      <div
                        key={i}
                        className={`text-xs font-mono px-2 py-1 rounded ${
                          tc.success
                            ? "bg-emerald-50 text-emerald-900"
                            : "bg-red-50 text-red-900"
                        }`}
                      >
                        {tc.success ? "✓" : "✗"} {tc.agent}: {tc.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {e.finalMessage && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                    Resposta do orquestrador ({e.finalMessage.length} chars)
                  </summary>
                  <div className="mt-2 text-xs text-gray-700 bg-gray-50 rounded p-3 whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {e.finalMessage}
                  </div>
                </details>
              )}

              {e.nextNodes.length > 0 && (
                <div className="mt-2 text-xs text-gray-400 font-mono">
                  next: [{e.nextNodes.join(", ")}]
                </div>
              )}

              <div className="mt-2 text-[10px] text-gray-300 font-mono truncate">
                {e.checkpointId}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
