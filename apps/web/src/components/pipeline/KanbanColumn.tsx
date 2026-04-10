"use client";

import { useDroppable } from "@dnd-kit/core";
import { KanbanCard, type DealCard } from "./KanbanCard";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

interface KanbanColumnProps {
  id: string;
  name: string;
  color: string;
  deals: DealCard[];
}

export function KanbanColumn({ id, name, color, deals }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-[300px] w-[300px] rounded-xl bg-muted/30 transition-all flex flex-col",
        isOver && "bg-muted/60 ring-2 ring-primary/20"
      )}
    >
      {/* Column header with color bar */}
      <div className="rounded-t-xl px-4 pt-1 pb-3" style={{ borderTop: `3px solid ${color}` }}>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">{name}</h3>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-medium">
              {deals.length}
            </span>
          </div>
        </div>
        {totalValue > 0 && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
          </p>
        )}
      </div>

      {/* Cards area */}
      <div className="px-2 pb-2 space-y-2 flex-1 min-h-[80px]">
        {deals.map((deal) => (
          <KanbanCard key={deal.id} deal={deal} />
        ))}

        {deals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              Arraste negocios aqui
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
