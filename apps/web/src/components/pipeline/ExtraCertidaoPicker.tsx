"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { Badge } from "@/components/ui/badge";
import type {
  EndpointInfo,
  EndpointAppliesTo,
} from "@/lib/certidoes/endpoints";

export interface CatalogMeta {
  ufs: string[];
  categories: Array<{ id: string; label: string }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The complete catalog (loaded from /plan?full=1) */
  catalog: EndpointInfo[];
  catalogMeta: CatalogMeta;
  /** Endpoints already selected for this target (shown disabled) */
  alreadySelected: Set<string>;
  /** Target kind — filters endpoints by appliesTo */
  targetKind: "pessoa" | "imovel";
  /** Target label for the dialog title */
  targetLabel: string;
  /** Called when user confirms with the list of endpoint IDs to add */
  onConfirm: (endpointIds: string[]) => void;
}

function scopeLabel(scope: string): string {
  return scope === "federal"
    ? "Federal"
    : scope === "estadual"
    ? "Estadual"
    : scope === "municipal"
    ? "Municipal"
    : scope;
}

export function ExtraCertidaoPicker({
  open,
  onOpenChange,
  catalog,
  catalogMeta,
  alreadySelected,
  targetKind,
  targetLabel,
  onConfirm,
}: Props) {
  const [search, setSearch] = useState("");
  const [ufFilter, setUfFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const appliesFilter: EndpointAppliesTo = targetKind;
    return catalog
      .filter((e) => e.appliesTo.includes(appliesFilter))
      .filter((e) => {
        if (search && !e.label.toLowerCase().includes(search.toLowerCase())) return false;
        if (ufFilter && e.uf !== ufFilter && e.scope !== "federal") return false;
        if (categoryFilter && e.category !== categoryFilter) return false;
        return true;
      });
  }, [catalog, search, ufFilter, categoryFilter, targetKind]);

  const grouped = useMemo(() => {
    const groups: Record<string, EndpointInfo[]> = {
      federal: [],
      estadual: [],
      municipal: [],
    };
    for (const e of filtered) {
      groups[e.scope].push(e);
    }
    return groups;
  }, [filtered]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected));
    setSelected(new Set());
    setSearch("");
    setUfFilter("");
    setCategoryFilter("");
  };

  const handleCancel = () => {
    setSelected(new Set());
    setSearch("");
    setUfFilter("");
    setCategoryFilter("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Adicionar certidões extras</DialogTitle>
          <DialogDescription>
            Selecione certidões adicionais para <strong>{targetLabel}</strong>.
            Use os filtros para encontrar certidões de outras UFs ou categorias.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 shrink-0">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome…"
            className="h-9 flex-1"
          />
          <NativeSelect
            value={ufFilter}
            onChange={setUfFilter}
            options={[
              { value: "", label: "Todas UFs" },
              ...catalogMeta.ufs.map((u) => ({ value: u, label: u })),
            ]}
            className="h-9 w-24"
          />
          <NativeSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "", label: "Todas categorias" },
              ...catalogMeta.categories.map((c) => ({ value: c.id, label: c.label })),
            ]}
            className="h-9 w-40"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {(["federal", "estadual", "municipal"] as const).map((scope) => {
            const items = grouped[scope];
            if (!items || items.length === 0) return null;
            return (
              <div key={scope}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {scopeLabel(scope)}
                </h3>
                <div className="space-y-1">
                  {items.map((e) => {
                    const isAlready = alreadySelected.has(e.id);
                    const isChecked = selected.has(e.id);
                    return (
                      <div
                        key={e.id}
                        className={`flex items-start gap-2 rounded border p-2 text-sm ${
                          isAlready ? "opacity-50" : "hover:bg-muted/30 cursor-pointer"
                        }`}
                        onClick={() => !isAlready && toggleSelect(e.id)}
                      >
                        <input
                          type="checkbox"
                          checked={isAlready || isChecked}
                          disabled={isAlready}
                          onChange={() => {}}
                          className="mt-0.5 h-4 w-4 accent-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium">{e.label}</span>
                            {e.uf && (
                              <Badge variant="outline" className="text-[10px]">
                                {e.uf}
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-[10px]">
                              R$ {(e.costCents / 100).toFixed(2).replace(".", ",")}
                            </Badge>
                            {isAlready && (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                já selecionada
                              </Badge>
                            )}
                          </div>
                          {e.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {e.description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum endpoint encontrado com esses filtros.
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={selected.size === 0}>
            Adicionar {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
