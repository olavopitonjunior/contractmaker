"use client";

import { useDroppable } from "@dnd-kit/core";
import { KanbanCard, type DealCard } from "./KanbanCard";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  id: string;
  name: string;
  color: string;
  deals: DealCard[];
}

export function KanbanColumn({ id, name, color, deals }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-[300px] rounded-lg border bg-muted/40 p-4 transition-colors",
        isOver && "bg-muted/70 border-primary/30"
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h3 className="font-medium text-sm">{name}</h3>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {deals.length}
        </span>
      </div>

      <div className="space-y-2 min-h-[60px]">
        {deals.map((deal) => (
          <KanbanCard key={deal.id} deal={deal} />
        ))}
        {deals.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Arraste negocios aqui
          </p>
        )}
      </div>
    </div>
  );
}
