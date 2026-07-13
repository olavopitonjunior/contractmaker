"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, ScrollText } from "lucide-react";

export interface ClientCertidaoJob {
  id: string;
  label: string;
  status: string;
  situacao: string | null;
  portalUrl: string | null;
  attachmentId: string | null;
}

const PENDING = new Set([
  "pending",
  "fetching",
  "queued",
  "api_error",
  "rate_limited",
  "portal_unavailable",
]);

function statusBadge(status: string, situacao: string | null) {
  if (PENDING.has(status)) return <Badge variant="outline">Consultando…</Badge>;
  if (status === "success") {
    if (situacao === "negativa" || situacao === "sem_restricao")
      return (
        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400">
          Nada consta
        </Badge>
      );
    if (situacao === "positiva" || situacao === "com_restricao")
      return <Badge variant="destructive">Consta</Badge>;
    return <Badge variant="secondary">Emitida</Badge>;
  }
  if (status === "failed_permanent" || status === "failed")
    return <Badge variant="destructive">Falha</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export function ClientCertidoesCard({
  clientId,
  hasDoc,
  jobs,
}: {
  clientId: string;
  hasDoc: boolean;
  jobs: ClientCertidaoJob[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const hasPending = jobs.some((j) => PENDING.has(j.status));

  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [hasPending, router]);

  async function dispatch() {
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/clients/${clientId}/certidoes`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Falha ao emitir certidões");
        return;
      }
      toast.success(`${d.jobCount} certidão(ões) em emissão`);
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <ScrollText className="h-4 w-4" /> Certidões
        </CardTitle>
        <Button size="sm" variant="outline" onClick={dispatch} disabled={busy || hasPending || !hasDoc}>
          {busy ? "Emitindo…" : jobs.length > 0 ? "Reemitir" : "Emitir certidões"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasDoc && (
          <p className="text-xs text-muted-foreground">Preencha o CPF/CNPJ do cliente para emitir certidões.</p>
        )}
        {jobs.length === 0 ? (
          hasDoc && (
            <p className="text-sm text-muted-foreground">
              Nenhuma certidão ainda. Emite CNDT (trabalhista) e CND Federal/PGFN.
            </p>
          )
        ) : (
          <ul className="divide-y">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                <p className="min-w-0 truncate text-sm">{j.label}</p>
                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge(j.status, j.situacao)}
                  {j.attachmentId ? (
                    <a
                      href={`/api/locacao/clients/${clientId}/attachments/${j.attachmentId}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      title="Abrir PDF"
                    >
                      <FileText className="h-4 w-4" />
                    </a>
                  ) : j.portalUrl && (j.status === "failed_permanent" || j.status === "failed") ? (
                    <a
                      href={j.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      Portal
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
