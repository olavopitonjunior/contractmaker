"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Teto mensal de IA da org (USD). GET/PUT em /api/settings/ai-budget.
 * Owner/admin edita; membro só vê. Vazio = sem teto.
 */
export function AiBudgetCard({
  initial,
  canEdit,
}: {
  initial: { budgetUsd: number | null; spentUsd: number; pct: number };
  canEdit: boolean;
}) {
  const [budgetUsd, setBudgetUsd] = useState<number | null>(initial.budgetUsd);
  const [input, setInput] = useState<string>(
    initial.budgetUsd != null ? String(initial.budgetUsd) : ""
  );
  const [saving, setSaving] = useState(false);

  const spent = initial.spentUsd;
  const pct = budgetUsd && budgetUsd > 0 ? Math.min(100, Math.round((spent / budgetUsd) * 100)) : 0;

  async function save(value: number | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ai-budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetUsd: value }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Falha ao salvar o budget");
        return;
      }
      setBudgetUsd(value);
      toast.success(value == null ? "Teto removido." : `Teto mensal salvo: US$ ${value.toFixed(2)}.`);
    } catch {
      toast.error("Falha de rede.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Budget mensal de IA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            US$ {spent.toFixed(2)}
          </span>
          <span className="text-sm text-muted-foreground">
            {budgetUsd != null ? `de US$ ${budgetUsd.toFixed(2)} · ${pct}%` : "gasto no mês (sem teto)"}
          </span>
        </div>
        {budgetUsd != null && (
          <div className="h-1.5 rounded bg-muted overflow-hidden">
            <div
              className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-green-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Ao atingir 100%, o chat de contratos pausa até o próximo mês ou ajuste do
          teto. Alertas no sino a 80% e 100%. Deixe em branco pra não ter teto.
        </p>
        {canEdit && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Teto mensal (US$)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="sem teto"
                className="w-40"
              />
            </div>
            <Button
              disabled={saving}
              onClick={() => {
                const n = input.trim() === "" ? null : Number(input);
                if (n != null && (!Number.isFinite(n) || n < 1)) {
                  toast.error("Informe um valor ≥ 1 ou deixe em branco.");
                  return;
                }
                save(n);
              }}
            >
              {saving ? "Salvando…" : "Salvar"}
            </Button>
            {budgetUsd != null && (
              <Button variant="ghost" disabled={saving} onClick={() => { setInput(""); save(null); }}>
                Remover teto
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
