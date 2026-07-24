"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUDIENCE_BY_KIND,
  TRIGGER_STAGES_BY_KIND,
} from "@/lib/surveys/types";

interface AutomationRow {
  id: string;
  dealKind: string;
  triggerStageName: string;
  audience: string[];
  channel: string;
  enabled: boolean;
  reminderOffsetsDays: number[];
}

const ROLE_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  locador: "Locador",
  locatario: "Locatário",
  corretor: "Corretor",
};

/**
 * Automações de disparo da FAMÍLIA (não da versão): nova versão da pesquisa
 * redireciona os próximos envios pro novo lote sem mexer aqui.
 */
export function SurveyAutomationDialog({
  familyId,
  surveyName,
}: {
  familyId: string;
  surveyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AutomationRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  // Form de nova automação
  const [dealKind, setDealKind] = useState<"venda" | "locacao">("venda");
  const [stage, setStage] = useState<string>("");
  const [audience, setAudience] = useState<Set<string>>(new Set(["comprador"]));
  const [channel, setChannel] = useState<"email" | "manual">("email");
  const [offsets, setOffsets] = useState("2, 5");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/surveys/automations?family=${familyId}`, {
      credentials: "same-origin",
    });
    setRows(res.ok ? (await res.json()).automations : []);
  }, [familyId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function toggle(row: AutomationRow, enabled: boolean) {
    const res = await fetch(`/api/surveys/automations/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) void load();
    else toast.error("Falha ao atualizar automação");
  }

  async function remove(row: AutomationRow) {
    const res = await fetch(`/api/surveys/automations/${row.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      toast.success("Automação removida");
      void load();
    } else toast.error("Falha ao remover");
  }

  async function create() {
    const parsedOffsets = offsets
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 60)
      .slice(0, 5);
    setSaving(true);
    try {
      const res = await fetch("/api/surveys/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          templateFamilyId: familyId,
          dealKind,
          triggerStageName: stage,
          audience: Array.from(audience),
          channel,
          enabled: true,
          reminderOffsetsDays: parsedOffsets,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao criar automação");
        return;
      }
      toast.success("Disparo automático configurado");
      setCreating(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  const stagesForKind = TRIGGER_STAGES_BY_KIND[dealKind] ?? [];
  const rolesForKind = AUDIENCE_BY_KIND[dealKind] ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Zap className="mr-1 h-3.5 w-3.5" /> Automação
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Disparo automático — {surveyName}</DialogTitle>
        </DialogHeader>

        {rows === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {rows.length === 0 && !creating && (
              <p className="text-sm text-muted-foreground">
                Nenhum disparo automático. A pesquisa também pode ser enviada
                manualmente pela aba Pesquisas do negócio.
              </p>
            )}

            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                      {row.dealKind === "locacao" ? "Locação" : "Vendas"}
                    </Badge>
                    <span className="font-medium">{row.triggerStageName}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.audience.map((r) => ROLE_LABEL[r] ?? r).join(", ")} ·{" "}
                    {row.channel === "email" ? "e-mail" : "link manual"}
                    {row.reminderOffsetsDays.length > 0 &&
                      ` · lembretes D+${row.reminderOffsetsDays.join(", D+")}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(v) => toggle(row, v)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => remove(row)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            {creating ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={dealKind}
                    onValueChange={(v) => {
                      setDealKind(v as "venda" | "locacao");
                      setStage("");
                      setAudience(new Set());
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="venda">Vendas</SelectItem>
                      <SelectItem value="locacao">Locação</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={stage} onValueChange={setStage}>
                    <SelectTrigger>
                      <SelectValue placeholder="Etapa gatilho" />
                    </SelectTrigger>
                    <SelectContent>
                      {stagesForKind.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-2">
                  {rolesForKind.map((role) => (
                    <label
                      key={role}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                    >
                      <Checkbox
                        checked={audience.has(role)}
                        onCheckedChange={(v) =>
                          setAudience((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(role);
                            else next.delete(role);
                            return next;
                          })
                        }
                      />
                      {ROLE_LABEL[role]}
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={channel}
                    onValueChange={(v) => setChannel(v as "email" | "manual")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">E-mail automático</SelectItem>
                      <SelectItem value="manual">Só gerar link</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={offsets}
                    onChange={(e) => setOffsets(e.target.value)}
                    placeholder="Lembretes (dias): 2, 5"
                    title="Dias após o envio pra lembrar quem não respondeu"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  WhatsApp automático chega com a integração Newton/Max — por ora
                  e-mail ou link manual.
                </p>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    disabled={saving || !stage || audience.size === 0}
                    onClick={create}
                  >
                    {saving ? "Salvando…" : "Criar automação"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Nova automação
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
