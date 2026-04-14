"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Save, RotateCcw, Bot } from "lucide-react";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { AGENT_TOOLS } from "@/lib/ai/tools";

interface AgentSettingsProps {
  initialConfig: {
    model: string;
    ocrModel: string;
    temperature: number;
    maxTokens: number;
    systemPrompt: string;
  } | null;
}

export function AgentSettings({ initialConfig }: AgentSettingsProps) {
  const [model, setModel] = useState(initialConfig?.model || "claude-sonnet-4-20250514");
  const [ocrModel, setOcrModel] = useState(initialConfig?.ocrModel || "claude-haiku-4-5-20251001");
  const [temperature, setTemperature] = useState(initialConfig?.temperature ?? 0.3);
  const [maxTokens, setMaxTokens] = useState(initialConfig?.maxTokens ?? 4096);
  const [systemPrompt, setSystemPrompt] = useState(initialConfig?.systemPrompt || DEFAULT_SYSTEM_PROMPT);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await fetch("/api/settings/agent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, ocrModel, temperature, maxTokens, systemPrompt }),
    });
    setSaving(false);

    if (res.ok) {
      toast.success("Configurações do agente salvas!");
    } else {
      toast.error("Erro ao salvar configurações");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Agente IA - Confecção de Contratos
          </CardTitle>
          <CardDescription>
            Configure o modelo, temperatura e prompt do agente que auxilia na
            confecção e edição de contratos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Modelo principal (contratos)</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-20250514">
                    Claude Sonnet 4.5 (recomendado)
                  </SelectItem>
                  <SelectItem value="claude-opus-4-20250514">
                    Claude Opus 4
                  </SelectItem>
                  <SelectItem value="claude-haiku-4-5-20251001">
                    Claude Haiku 4.5 (econômico)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Modelo OCR (documentos)</Label>
              <Select value={ocrModel} onValueChange={setOcrModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-haiku-4-5-20251001">
                    Claude Haiku 4.5 (recomendado - $0.003/doc)
                  </SelectItem>
                  <SelectItem value="claude-sonnet-4-20250514">
                    Claude Sonnet 4.5 (mais preciso)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                Temperatura: {temperature.toFixed(1)}
              </Label>
              <Input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                Baixo (0.1) = mais conservador. Alto (0.8) = mais criativo.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Máximo de tokens</Label>
              <Input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)}
                min={512}
                max={8192}
                step={512}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>System Prompt</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Restaurar padrão
              </Button>
            </div>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder="Instruções para o agente IA..."
            />
            <p className="text-xs text-muted-foreground">
              Este prompt define o comportamento do agente na tela de edição de contratos.
              O agente tem acesso a {AGENT_TOOLS.length} ferramentas: consulta de cláusulas
              e templates, edição, validação, sugestões, extração de documentos, análise de
              contradições, base de conhecimento (RAG), aprendizado com contratos aprovados,
              modo Propose, aplicação de presets de estilo e inserção de imagens.
            </p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
