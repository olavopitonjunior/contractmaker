"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AiInsightsConfig } from "@/app/(dashboard)/settings/ai-insights/types";

interface Props {
  initialConfig: AiInsightsConfig;
}

const CONTEXT_DESCRIPTIONS: Record<keyof AiInsightsConfig["contexts"], string> = {
  dashboard: "Painel geral de locação (/locacao)",
  contract: "Detalhe de cada contrato",
  property: "Detalhe de cada imóvel",
  cashflow: "Página de repasses (fluxo de caixa)",
};

export function AiInsightsConfigForm({ initialConfig }: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<AiInsightsConfig>(initialConfig);
  const [saving, setSaving] = useState(false);

  function toggleContext(key: keyof AiInsightsConfig["contexts"]) {
    setConfig((prev) => ({
      ...prev,
      contexts: { ...prev.contexts, [key]: !prev.contexts[key] },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/ai/insights/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success("Configuração salva");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label className="text-sm font-medium">Habilitado globalmente</Label>
          <p className="text-xs text-muted-foreground">
            Desligar suprime insights em todas as superfícies da org.
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v: boolean) => setConfig((p) => ({ ...p, enabled: v }))}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Contextos</div>
        <div className="space-y-2">
          {(Object.keys(config.contexts) as Array<keyof AiInsightsConfig["contexts"]>).map((k) => (
            <div
              key={k}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div>
                <Label className="text-sm font-medium capitalize">{k}</Label>
                <p className="text-xs text-muted-foreground">{CONTEXT_DESCRIPTIONS[k]}</p>
              </div>
              <Switch
                checked={config.contexts[k]}
                onCheckedChange={() => toggleContext(k)}
                disabled={!config.enabled}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
