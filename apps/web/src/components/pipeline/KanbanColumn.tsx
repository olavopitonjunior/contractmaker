"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  KanbanCard,
  type DealCard,
  type KanbanCardConfig,
} from "./KanbanCard";
import { cn } from "@/lib/utils";
import { formatMoneyBR } from "@/lib/format/money";
import { Plus, Search, XOctagon } from "lucide-react";

interface KanbanColumnProps {
  id: string;
  name: string;
  color: string;
  deals: DealCard[];
  isLost?: boolean;
  config?: KanbanCardConfig;
  /** Instante do render do server — ver KanbanBoard.nowMs. Obrigatório. */
  nowMs: number;
  /** Há busca/filtro client ativo — muda o empty state pra "Nenhum resultado". */
  isFiltering?: boolean;
}

export function KanbanColumn({
  id,
  name,
  color,
  deals,
  isLost,
  config,
  nowMs,
  isFiltering,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-[260px] w-[260px] sm:min-w-[300px] sm:w-[300px] rounded-xl transition-all flex flex-col",
        isLost ? "bg-red-500/[0.04]" : "bg-muted/30",
        isOver && (isLost ? "bg-red-500/10 ring-2 ring-red-500/30" : "bg-muted/60 ring-2 ring-primary/20")
      )}
    >
      {/* Column header with color bar */}
      <div className="rounded-t-xl px-4 pt-1 pb-3" style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            {isLost && <XOctagon className="h-4 w-4 text-red-500" />}
            <h3
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                isLost && "text-red-700 dark:text-red-400"
              )}
            >
              {name}
            </h3>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-medium tabular-nums">
              {deals.length}
            </span>
          </div>
        </div>
        {totalValue > 0 && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {formatMoneyBR(totalValue, { decimals: 0 })}
          </p>
        )}
      </div>

      {/* Cards area */}
      <div className="px-2 pb-2 space-y-2 flex-1 min-h-[80px]">
        {deals.map((deal) => (
          <KanbanCard
            key={deal.id}
            deal={deal}
            currentStageName={name}
            config={config}
            nowMs={nowMs}
          />
        ))}

        {deals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-2">
              {isFiltering ? (
                <Search className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Plus className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isFiltering
                ? "Nenhum resultado"
                : isLost
                  ? "Sem negócios perdidos"
                  : "Arraste negócios aqui"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
