"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { STATUS_FILTERS } from "@/lib/proposals/list-filters";

export interface ListFilters {
  q: string;
  status: string;
  responsibleUserId: string;
}

const selectCls =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus:outline-hidden focus:ring-2 focus:ring-ring";

export function ProposalFilters({
  tipo,
  showTabs,
  members,
  filters,
}: {
  tipo: "venda" | "locacao";
  showTabs: boolean;
  members: { id: string; name: string }[];
  filters: ListFilters;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);

  function push(next: Partial<{ tipo: string } & ListFilters>) {
    const merged = { tipo, ...filters, q, ...next };
    const params = new URLSearchParams();
    if (merged.tipo) params.set("tipo", merged.tipo);
    if (merged.q?.trim()) params.set("q", merged.q.trim());
    if (merged.status && merged.status !== "all") params.set("status", merged.status);
    if (merged.responsibleUserId) params.set("responsibleUserId", merged.responsibleUserId);
    router.push(`/pipeline/propostas?${params.toString()}`);
  }

  const hasFilters =
    !!filters.q || (filters.status && filters.status !== "all") || !!filters.responsibleUserId;

  return (
    <Card className="flex flex-wrap items-center gap-2 p-3">
      {showTabs && (
        <div className="inline-flex rounded-md border p-0.5 text-sm">
          {(["venda", "locacao"] as const).map((t) => (
            <button
              key={t}
              onClick={() => push({ tipo: t })}
              className={`rounded px-3 py-1 transition-colors ${
                tipo === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "venda" ? "Vendas" : "Locação"}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          push({ q });
        }}
        className="relative flex-1 min-w-[180px]"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por proponente ou imóvel…"
          className="pl-8"
        />
      </form>

      <select
        aria-label="Status"
        className={selectCls}
        value={filters.status || "all"}
        onChange={(e) => push({ status: e.target.value })}
      >
        {STATUS_FILTERS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Responsável"
        className={selectCls}
        value={filters.responsibleUserId || ""}
        onChange={(e) => push({ responsibleUserId: e.target.value })}
      >
        <option value="">Todos os responsáveis</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            router.push(`/pipeline/propostas?tipo=${tipo}`);
          }}
        >
          <X className="mr-1 h-4 w-4" /> Limpar
        </Button>
      )}
    </Card>
  );
}
