"use client";

import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import Link from "next/link";

export interface DealCard {
  id: string;
  title: string;
  value: number | null;
  createdAt: string;
  formStatus: string | null;
  hasContract: boolean;
}

interface KanbanCardProps {
  deal: DealCard;
  isOverlay?: boolean;
}

export function KanbanCard({ deal, isOverlay }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  const daysAgo = Math.floor(
    (Date.now() - new Date(deal.createdAt).getTime()) / 86400000
  );

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(isDragging && "opacity-50")}
    >
      <Link href={`/deals/${deal.id}`}>
        <Card
          className={cn(
            "cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors",
            isOverlay && "shadow-lg rotate-2"
          )}
        >
          <CardContent className="p-3">
            <p className="font-medium text-sm leading-tight">{deal.title}</p>

            <div className="flex items-center gap-2 mt-2">
              {deal.value != null && (
                <span className="text-xs font-medium text-primary">
                  R${" "}
                  {deal.value.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {daysAgo === 0 ? "hoje" : `${daysAgo}d`}
              </span>
            </div>

            <div className="flex items-center gap-1 mt-2">
              {deal.formStatus && (
                <Badge
                  variant={
                    deal.formStatus === "completo" ? "default" : "secondary"
                  }
                  className="text-[10px] h-5"
                >
                  {deal.formStatus}
                </Badge>
              )}
              {deal.hasContract && (
                <Badge variant="outline" className="text-[10px] h-5">
                  <FileText className="h-3 w-3 mr-0.5" />
                  contrato
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
