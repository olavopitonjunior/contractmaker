"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SPECIALISTS = [
  { key: "analyst", label: "Analyst (validação/contradições — read-only)" },
  { key: "legal", label: "Legal (parecer jurídico — read-only)" },
  { key: "editor", label: "Editor (escrita no contrato)" },
  { key: "curator", label: "Curator (biblioteca/propostas)" },
] as const;

const MODEL_OPTIONS = [
  { value: "__default", label: "Padrão (hardcoded)" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
];

type Fields = Record<string, string>;

export function AgentDefaultsClient({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prompts, setPrompts] = useState<Fields>({});
  const [models, setModels] = useState<Fields>({});
  const [defaults, setDefaults] = useState<Fields>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/agent-defaults");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Falha ao carregar");
        const o = data.overrides ?? {};
        const p: Fields = {};
        const m: Fields = {};
        for (const { key } of SPECIALISTS) {
          p[key] = o[`${key}Prompt`] ?? "";
          m[key] = o[`${key}Model`] ?? "__default";
        }
        setPrompts(p);
        setModels(m);
        setDefaults(data.defaults ?? {});
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao carregar");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      for (const { key } of SPECIALISTS) {
        body[`${key}Prompt`] = prompts[key]?.trim() || null;
        body[`${key}Model`] =
          models[key] && models[key] !== "__default" ? models[key] : null;
      }
      const res = await fetch("/api/admin/agent-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar");
      toast.success("Overrides salvos — pegam em ≤1 min.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="space-y-6">
      {SPECIALISTS.map(({ key, label }) => (
        <Card key={key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-w-xs">
              <Select
                value={models[key] ?? "__default"}
                onValueChange={(v) => setModels((s) => ({ ...s, [key]: v }))}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Modelo" />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                      {o.value === "__default" && defaults[`${key}Model`]
                        ? ` — ${defaults[`${key}Model`]}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={prompts[key] ?? ""}
              onChange={(e) => setPrompts((s) => ({ ...s, [key]: e.target.value }))}
              disabled={!canEdit}
              rows={6}
              placeholder={`Instruções adicionais apendadas ao prompt-base (venda × locação). Vazio = sem override.\n\nReferência do baseline (venda):\n${(defaults[`${key}Prompt`] ?? "").slice(0, 300)}…`}
              className="font-mono text-xs"
            />
          </CardContent>
        </Card>
      ))}
      {canEdit && (
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar overrides"}
        </Button>
      )}
    </div>
  );
}
