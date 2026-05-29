"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";

interface Clausula {
  id?: string;
  titulo: string;
  conteudo: string;
}

interface Props {
  leaseId: string;
  initialClausulas: Clausula[];
}

export function ClausulasAdicionaisEditor({ leaseId, initialClausulas }: Props) {
  const router = useRouter();
  const [clausulas, setClausulas] = useState<Clausula[]>(initialClausulas);
  const [saving, setSaving] = useState(false);

  function add() {
    setClausulas((prev) => [...prev, { titulo: "", conteudo: "" }]);
  }
  function update(i: number, field: "titulo" | "conteudo", v: string) {
    setClausulas((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: v } : c)));
  }
  function remove(i: number) {
    setClausulas((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    try {
      const valid = clausulas.filter((c) => c.titulo.trim().length >= 2 && c.conteudo.trim().length >= 5);
      const res = await fetch(`/api/locacao/leases/${leaseId}/clausulas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clausulas: valid.map((c) => ({ titulo: c.titulo.trim(), conteudo: c.conteudo.trim() })),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${valid.length} cláusula(s) salva(s)`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {clausulas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma cláusula adicional. Use o botão abaixo pra adicionar (ex.: regulamentos do
          condomínio, vedação a animais, taxa de mudança).
        </p>
      )}
      {clausulas.map((c, i) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Título (ex.: Cláusula X — Animais)"
              value={c.titulo}
              onChange={(e) => update(i, "titulo", e.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(i)}
              aria-label="Remover cláusula"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            placeholder="Conteúdo da cláusula"
            value={c.conteudo}
            onChange={(e) => update(i, "conteudo", e.target.value)}
            rows={4}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={add} disabled={saving}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Adicionar cláusula
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
