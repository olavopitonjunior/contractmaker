"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_FILTERS } from "@/lib/proposals/list-filters";

export interface ListFilters {
  q: string;
  status: string;
  responsibleUserId: string;
}

/** Sentinela do "todos" no Select do responsável. Radix trata `value=""` como
 *  "sem valor" e o placeholder voltaria no lugar do rótulo escolhido. */
const ALL_RESPONSIBLES = "__all__";

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
    <Card className="p-3">
      {/*
        Empilha no mobile, uma linha só a partir de lg. A busca tem LARGURA FIXA
        em vez de `flex-1`: como `flex-1` entre o segmentado e os selects, ela
        esticava e empurrava tudo pro meio da barra, deixando a linha com cara de
        centralizada. Agora o grupo da direita é que absorve a sobra (`ml-auto`).
      */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {showTabs && (
          <div
            role="group"
            aria-label="Tipo de proposta"
            className="inline-flex shrink-0 self-start rounded-md border p-0.5 text-sm lg:self-auto"
          >
            {(["venda", "locacao"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tipo === t}
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
          className="relative w-full lg:w-72"
          role="search"
        >
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por proponente ou imóvel…"
            aria-label="Buscar propostas"
            className="pl-8 pr-8"
          />
          {q && (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => {
                setQ("");
                push({ q: "" });
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Select
            value={filters.status || "all"}
            onValueChange={(status) => push({ status })}
          >
            <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.responsibleUserId || ALL_RESPONSIBLES}
            onValueChange={(v) =>
              push({ responsibleUserId: v === ALL_RESPONSIBLES ? "" : v })
            }
          >
            <SelectTrigger className="h-9 w-full sm:w-52" aria-label="Responsável">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_RESPONSIBLES}>Todos os responsáveis</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
        </div>
      </div>
    </Card>
  );
}
