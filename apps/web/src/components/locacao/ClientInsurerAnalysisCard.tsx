"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck } from "lucide-react";
import {
  LEASE_INSURERS,
  matchInsurerKey,
  INSURER_STATUSES,
  INSURER_STATUS_LABEL,
  INSURER_STATUS_TONE,
} from "@/lib/locacao/insurers";

export interface InsurerAnalysisRow {
  id: string;
  seguradora: string;
  status: string;
  premioMensal: number | null;
}

export function ClientInsurerAnalysisCard({
  clientId,
  analyses,
}: {
  clientId: string;
  analyses: InsurerAnalysisRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Roster fixo das 6 seguradoras — cada uma casada com a análise existente (se houver).
  const rosterRows = LEASE_INSURERS.map((ins) => {
    const existing = analyses.find((a) => matchInsurerKey(a.seguradora) === ins.key);
    return { ins, existing };
  });
  // Análises fora do roster (custom/legado) — exibidas separadamente.
  const extras = analyses.filter((a) => matchInsurerKey(a.seguradora) === null);

  /** Cria (POST) ou atualiza (PATCH) o status de uma seguradora. */
  async function setStatus(opts: {
    analysisId?: string;
    seguradora: string;
    status: string;
  }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/clients/${clientId}/insurer-analyses`, {
        method: opts.analysisId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          opts.analysisId
            ? { analysisId: opts.analysisId, status: opts.status }
            : { seguradora: opts.seguradora, status: opts.status }
        ),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    } finally {
      setBusy(false);
    }
  }

  function StatusSelect({
    value,
    onPick,
  }: {
    value: string | undefined;
    onPick: (s: string) => void;
  }) {
    return (
      <Select value={value} onValueChange={onPick} disabled={busy}>
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <SelectValue placeholder="Não enviado" />
        </SelectTrigger>
        <SelectContent>
          {INSURER_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {INSURER_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Fiança por seguradora
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rosterRows.map(({ ins, existing }) => (
            <li key={ins.key} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{ins.label}</p>
                {existing?.premioMensal != null && (
                  <p className="text-xs text-muted-foreground">
                    Prêmio:{" "}
                    {existing.premioMensal.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                    /mês
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {existing ? (
                  <Badge variant={INSURER_STATUS_TONE[existing.status] ?? "outline"}>
                    {INSURER_STATUS_LABEL[existing.status] ?? existing.status}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground/70">
                    Não enviado
                  </Badge>
                )}
                <StatusSelect
                  value={existing?.status}
                  onPick={(s) =>
                    setStatus({ analysisId: existing?.id, seguradora: ins.label, status: s })
                  }
                />
              </div>
            </li>
          ))}

          {extras.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <p className="text-sm font-medium capitalize truncate">{a.seguradora}</p>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={INSURER_STATUS_TONE[a.status] ?? "outline"}>
                  {INSURER_STATUS_LABEL[a.status] ?? a.status}
                </Badge>
                <StatusSelect
                  value={a.status}
                  onPick={(s) => setStatus({ analysisId: a.id, seguradora: a.seguradora, status: s })}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
