"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface AgentRow {
  agentKey: string;
  label: string;
  description: string;
  instructions: string;
  model: string;
  enabled: boolean;
}

export function AiAgentsClient({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/ai-agents");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Falha ao carregar");
        setAgents(data.agents ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao carregar");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(row: AgentRow) {
    setSavingKey(row.agentKey);
    try {
      const res = await fetch("/api/settings/ai-agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentKey: row.agentKey,
          instructions: row.instructions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar");
      toast.success("Instruções salvas — valem em ≤1 min.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="space-y-4">
      {agents.map((row) => (
        <Card key={row.agentKey}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">{row.label}</CardTitle>
              {!row.enabled && <Badge variant="destructive">desativado</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">{row.description}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={row.instructions}
              onChange={(e) =>
                setAgents((rows) =>
                  rows.map((r) =>
                    r.agentKey === row.agentKey
                      ? { ...r, instructions: e.target.value }
                      : r
                  )
                )
              }
              disabled={!canEdit}
              rows={5}
              placeholder="Ex.: sempre citar o número da matrícula ao falar do imóvel. Vazio = sem instrução extra."
              className="text-sm"
            />
            {canEdit && (
              <Button
                size="sm"
                onClick={() => save(row)}
                disabled={savingKey === row.agentKey}
              >
                {savingKey === row.agentKey ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
