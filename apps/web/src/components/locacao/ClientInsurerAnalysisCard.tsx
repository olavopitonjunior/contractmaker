"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, Plus } from "lucide-react";

export interface InsurerAnalysisRow {
  id: string;
  seguradora: string;
  status: string;
  premioMensal: number | null;
}

const STATUSES = [
  "pendente",
  "enviado",
  "em_analise",
  "aprovado",
  "aprovado_com_restricao",
  "recusado",
] as const;

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  enviado: "Enviado",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  aprovado_com_restricao: "Aprovado c/ restrição",
  recusado: "Recusado",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  aprovado: "default",
  aprovado_com_restricao: "outline",
  em_analise: "secondary",
  enviado: "secondary",
  pendente: "outline",
  recusado: "destructive",
};

export function ClientInsurerAnalysisCard({
  clientId,
  analyses,
}: {
  clientId: string;
  analyses: InsurerAnalysisRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seguradora, setSeguradora] = useState("");
  const [status, setStatus] = useState<string>("pendente");

  async function addSeguradora(e: React.FormEvent) {
    e.preventDefault();
    if (!seguradora.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/clients/${clientId}/insurer-analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seguradora: seguradora.trim(), status }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success("Seguradora adicionada");
      setSeguradora("");
      setStatus("pendente");
      setAdding(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(analysisId: string, newStatus: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/clients/${clientId}/insurer-analyses`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, status: newStatus }),
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

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Fiança por seguradora
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4 mr-1.5" /> Adicionar seguradora
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <form onSubmit={addSeguradora} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="flex-1 space-y-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground">Seguradora</label>
              <Input
                value={seguradora}
                onChange={(e) => setSeguradora(e.target.value)}
                placeholder="ex.: Porto, Credpago"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy || !seguradora.trim()}>
              Salvar
            </Button>
          </form>
        )}

        {analyses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma seguradora ainda. Adicione as seguradoras às quais a fiança foi enviada e
            acompanhe o status de cada uma.
          </p>
        ) : (
          <ul className="divide-y">
            {analyses.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize truncate">{a.seguradora}</p>
                  {a.premioMensal != null && (
                    <p className="text-xs text-muted-foreground">
                      Prêmio: {a.premioMensal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={STATUS_TONE[a.status] ?? "outline"}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </Badge>
                  <Select value={a.status} onValueChange={(v) => updateStatus(a.id, v)} disabled={busy}>
                    <SelectTrigger className="h-8 w-[160px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
