"use client";

/**
 * Editor do escopo de RAG de um agente (`AgentProfile.ragScope`).
 *
 * Usado nas duas telas — /admin/agents (plataforma e override de tenant) e
 * /settings/ai-agents (a própria org) — porque o campo é o mesmo e a semântica
 * de "vazio = sem restrição" é fácil de errar em duas implementações.
 *
 * A tela toda parte de um princípio: OMISSÃO NUNCA TIRA ALCANCE. Nenhuma
 * categoria marcada significa "todas", não "nenhuma"; e a base da plataforma
 * só sai quando alguém desmarca de propósito.
 */

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { useState } from "react";

export interface RagScope {
  categories?: string[];
  tags?: string[];
  includePlatform?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  legislation: "Legislação",
  model: "Modelos",
  rule: "Regras",
  glossary: "Glossário",
  clause: "Cláusulas",
};

interface Props {
  value: RagScope | null;
  categories: readonly string[];
  disabled?: boolean;
  onChange: (next: RagScope | null) => void;
}

/** Vazio em tudo é o mesmo que "sem escopo" — grava `null` e volta a herdar. */
function normalize(s: RagScope): RagScope | null {
  const semCategorias = !s.categories?.length;
  const semTags = !s.tags?.length;
  const plataformaPadrao = s.includePlatform !== false;
  if (semCategorias && semTags && plataformaPadrao) return null;
  return {
    ...(s.categories?.length ? { categories: s.categories } : {}),
    ...(s.tags?.length ? { tags: s.tags } : {}),
    ...(s.includePlatform === false ? { includePlatform: false } : {}),
  };
}

export function RagScopeEditor({ value, categories, disabled, onChange }: Props) {
  const [tagInput, setTagInput] = useState("");
  const scope = value ?? {};
  const selected = scope.categories ?? [];
  const tags = scope.tags ?? [];

  const patch = (next: RagScope) => onChange(normalize({ ...scope, ...next }));

  function toggleCategory(c: string) {
    patch({
      categories: selected.includes(c)
        ? selected.filter((x) => x !== c)
        : [...selected, c],
    });
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    patch({ tags: [...tags, t] });
    setTagInput("");
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium mb-1.5">Categorias que este agente consulta</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const on = selected.includes(c);
            return (
              <button
                key={c}
                type="button"
                disabled={disabled}
                onClick={() => toggleCategory(c)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input text-muted-foreground hover:bg-muted"
                }`}
              >
                {CATEGORY_LABELS[c] ?? c}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {selected.length === 0
            ? "Nenhuma marcada = consulta todas."
            : `Restrito a ${selected.length} de ${categories.length}.`}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium mb-1.5">Tags (opcional)</p>
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px] gap-1">
              {t}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => patch({ tags: tags.filter((x) => x !== t) })}
                  aria-label={`Remover tag ${t}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </Badge>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            className="h-8 text-xs"
            placeholder="Ex.: locacao"
            value={tagInput}
            disabled={disabled}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Item precisa ter ao menos uma das tags. Vazio = sem filtro por tag.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded border p-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium">Consultar a base da plataforma</p>
          <p className="text-[11px] text-muted-foreground">
            Conteúdo universal mantido pela plataforma, somado ao da imobiliária.
            Desligue só se este agente tiver que responder exclusivamente com
            material próprio.
          </p>
        </div>
        <Switch
          checked={scope.includePlatform !== false}
          disabled={disabled}
          onCheckedChange={(on) => patch({ includePlatform: on ? undefined : false })}
        />
      </div>
    </div>
  );
}
