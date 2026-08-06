"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/useDebounce";
import {
  hasActiveBoardFilters,
  PERIODO_LABEL,
  SLA_FILTER_LABEL,
  type PipelineBoardFilters,
} from "@/lib/pipeline/list-filters";
import { DEAL_SOURCE_CHANNEL_LABEL } from "@/lib/pipeline/source-channel";

const ALL = "__all__";

export interface ResponsavelOption {
  id: string;
  label: string;
}

interface PipelineFiltersProps {
  /** Filtros parseados da URL (server) — estado inicial/espelho. */
  filters: PipelineBoardFilters;
  /** Usuários com deals no pipeline — opções do select "Responsável". */
  responsaveis: ResponsavelOption[];
  /** Totais pós-filtro do board (matching = _count; loaded = cards enviados). */
  totals: { matching: number; loaded: number };
}

/**
 * Barra de filtros SERVER-SIDE do kanban (PR 3.4) — cada mudança escreve na
 * URL e o Server Component refaz a query com o WHERE de list-filters.ts.
 * Substitui a toolbar client do KanbanBoard (que só filtrava os cards já
 * carregados — insuficiente com o cap de 200/stage).
 */
export function PipelineFilters({
  filters,
  responsaveis,
  totals,
}: PipelineFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(filters.q ?? "");
  const debouncedQ = useDebounce(q, 400);
  // Não re-navegar no mount (a URL já reflete o q inicial).
  const lastPushedQ = useRef(filters.q ?? "");

  function pushParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setParam(key: string, value: string | null) {
    pushParams((params) => {
      if (value === null || value === ALL || value === "") params.delete(key);
      else params.set(key, value);
    });
  }

  useEffect(() => {
    const next = debouncedQ.trim();
    if (next === lastPushedQ.current) return;
    lastPushedQ.current = next;
    setParam("q", next || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const hasFilter = hasActiveBoardFilters(filters);
  const truncated = totals.loaded < totals.matching;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por título ou cliente..."
          className="h-9 w-64 max-w-full pl-8 pr-8"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {responsaveis.length > 0 && (
        <Select
          value={filters.responsavel ?? ALL}
          onValueChange={(v) => setParam("responsavel", v)}
        >
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os responsáveis</SelectItem>
            {responsaveis.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={filters.sla ?? ALL} onValueChange={(v) => setParam("sla", v)}>
        <SelectTrigger className="h-9 w-36">
          <SelectValue placeholder="SLA" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>SLA: todos</SelectItem>
          {Object.entries(SLA_FILTER_LABEL).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.periodo ?? ALL}
        onValueChange={(v) => setParam("periodo", v)}
      >
        <SelectTrigger className="h-9 w-40">
          <SelectValue placeholder="Período" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Qualquer período</SelectItem>
          {Object.entries(PERIODO_LABEL).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.canal ?? ALL} onValueChange={(v) => setParam("canal", v)}>
        <SelectTrigger className="h-9 w-44">
          <SelectValue placeholder="Canal" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os canais</SelectItem>
          {Object.entries(DEAL_SOURCE_CHANNEL_LABEL).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant={filters.arquivados ? "secondary" : "outline"}
        size="sm"
        className="h-9"
        aria-pressed={filters.arquivados}
        onClick={() => setParam("arquivados", filters.arquivados ? null : "1")}
      >
        <Archive className="mr-1.5 h-3.5 w-3.5" />
        {filters.arquivados ? "Ocultar arquivados" : "Mostrar arquivados"}
      </Button>

      {hasFilter && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground"
          onClick={() => {
            setQ("");
            lastPushedQ.current = "";
            pushParams((params) => {
              for (const key of ["q", "responsavel", "sla", "periodo", "canal"]) {
                params.delete(key);
              }
            });
          }}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Limpar filtros
        </Button>
      )}

      {(hasFilter || truncated) && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {truncated
            ? `Mostrando ${totals.loaded} de ${totals.matching} negócios — refine os filtros`
            : `${totals.matching} ${totals.matching === 1 ? "negócio" : "negócios"}`}
        </span>
      )}
    </div>
  );
}
