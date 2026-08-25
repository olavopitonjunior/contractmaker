"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Trash2 } from "lucide-react";
import {
  GARANTIA_LABELS,
  GARANTIA_TIPOS,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";
import type { GarantiaOptionLike } from "@/lib/forms/garantia-catalog";

/**
 * Catálogo de garantias locatícias da imobiliária.
 *
 * O formulário de locação oferece cada par tipo × garantidor como UMA escolha
 * ("Seguro-fiança — Porto Seguro"), preenchendo `garantia.tipo` e
 * `garantia.provider` de uma vez. Antes o garantidor era texto livre e cada
 * corretor escrevia de um jeito — o que quebrava o pareamento com a cláusula da
 * seguradora, que é taggeada justamente por `provider`.
 *
 * Modalidades sem garantidor (fiador, caução, garantia própria, sem garantia)
 * aparecem no formulário de qualquer forma; não precisam ser cadastradas aqui.
 */

interface Props {
  initial: GarantiaOptionLike[];
}

/** Tipos que fazem sentido cadastrar com garantidor. */
const TIPOS_COM_GARANTIDOR: GarantiaTipo[] = [
  "seguro_fianca",
  "garantia_onerosa",
  "titulo_capitalizacao",
];

export function GarantiaOptionsCard({ initial }: Props) {
  const [options, setOptions] = useState<GarantiaOptionLike[]>(initial);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftTipo, setDraftTipo] = useState<GarantiaTipo>("seguro_fianca");
  const [draftProvider, setDraftProvider] = useState("");

  async function createOption() {
    const provider = draftProvider.trim();
    if (provider.length < 2) {
      toast.error("Informe o nome do garantidor");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/org/garantia-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: draftTipo, provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao cadastrar");
        return;
      }
      // A primeira gravação materializa os defaults no banco (ver a rota) —
      // recarrega a lista inteira pra tela não mentir sobre o que existe.
      const refreshed = await fetch("/api/org/garantia-options")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      setOptions(
        refreshed?.options ?? [...options, data.option as GarantiaOptionLike],
      );
      setDraftProvider("");
      setCreating(false);
      toast.success("Garantidor cadastrado — já aparece no formulário");
    } finally {
      setBusy(false);
    }
  }

  async function patchOption(id: string, body: Record<string, unknown>) {
    const before = options;
    setOptions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...body } : o)),
    );
    const res = await fetch(`/api/org/garantia-options/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setOptions(before);
      toast.error(data.error || "Falha ao salvar");
    }
  }

  async function removeOption(id: string) {
    const res = await fetch(`/api/org/garantia-options/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Falha ao excluir");
      return;
    }
    setOptions((prev) => prev.filter((o) => o.id !== id));
    toast.success("Garantidor removido");
  }

  const persisted = options.filter((o) => o.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Garantias aceitas</CardTitle>
        <CardDescription>
          As seguradoras e garantidoras com que a sua imobiliária trabalha. No
          formulário de locação cada uma vira uma escolha só —{" "}
          <em>Seguro-fiança — Porto Seguro</em> — e é ela que seleciona a
          cláusula da seguradora no contrato. Fiador, caução, garantia própria e
          &ldquo;sem garantia&rdquo; aparecem sempre, sem precisar cadastrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {persisted.length === 0 && options.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Você ainda não personalizou o catálogo — o formulário está usando a
            lista sugerida abaixo. Cadastrar a primeira garantidora salva a lista
            atual e acrescenta a nova.
          </p>
        )}

        <div className="space-y-2">
          {options.map((opt, idx) => (
            <div
              key={opt.id ?? `${opt.tipo}-${opt.provider}-${idx}`}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 flex-wrap"
            >
              <div className="min-w-0">
                <span className="font-medium">
                  {opt.label || opt.provider || GARANTIA_LABELS[opt.tipo as GarantiaTipo]}
                </span>
                <Badge variant="secondary" className="ml-2">
                  {GARANTIA_LABELS[opt.tipo as GarantiaTipo] ?? opt.tipo}
                </Badge>
                {opt.active === false && (
                  <Badge variant="outline" className="ml-2">
                    Desativada
                  </Badge>
                )}
                {!opt.id && (
                  <Badge variant="outline" className="ml-2">
                    Sugerida
                  </Badge>
                )}
              </div>
              {opt.id && (
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={opt.active !== false}
                      onCheckedChange={(active) =>
                        patchOption(opt.id as string, { active })
                      }
                    />
                    Ativa
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeOption(opt.id as string)}
                    title="Excluir (prefira desativar)"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {creating ? (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <div className="space-y-1.5">
                <Label className="text-xs">Modalidade</Label>
                <Select
                  value={draftTipo}
                  onValueChange={(v) => setDraftTipo(v as GarantiaTipo)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GARANTIA_TIPOS.filter((t) =>
                      TIPOS_COM_GARANTIDOR.includes(t),
                    ).map((t) => (
                      <SelectItem key={t} value={t}>
                        {GARANTIA_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="new-garantia-provider">
                  Garantidor
                </Label>
                <Input
                  id="new-garantia-provider"
                  value={draftProvider}
                  placeholder="Ex.: Porto Seguro"
                  onChange={(e) => setDraftProvider(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={createOption} disabled={busy}>
                {busy ? "Salvando…" : "Cadastrar"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Novo garantidor
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
