"use client";

import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FileText, Clock, Home, Link2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export interface DealCard {
  id: string;
  title: string;
  value: number | null;
  createdAt: string;
  formStatus: string | null;
  formToken: string | null;
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

  const msAgo = Date.now() - new Date(deal.createdAt).getTime();
  const hoursAgo = Math.floor(msAgo / 3600000);
  const daysAgo = Math.floor(msAgo / 86400000);
  const timeLabel = daysAgo > 0 ? `${daysAgo}d` : hoursAgo > 0 ? `${hoursAgo}h` : "agora";

  function handleCopyFormLink(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!deal.formToken) return;
    const url = `${window.location.origin}/f/${deal.formToken}`;
    navigator.clipboard.writeText(url);
    toast.success("Link do formulário copiado!");
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-deal-id={deal.id}
      className={cn("rounded-md transition-all", isDragging && "opacity-40")}
    >
      <Link href={`/deals/${deal.id}`}>
        <Card
          className={cn(
            "cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/30 transition-all",
            isOverlay && "shadow-xl rotate-1 scale-105"
          )}
        >
          <CardContent className="p-3 space-y-2.5">
            {/* Top row: icon + time */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium">Imóvel</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {deal.formToken && (
                  <button
                    type="button"
                    onClick={handleCopyFormLink}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded p-0.5 hover:bg-muted hover:text-foreground transition-colors"
                    title="Copiar link do formulário"
                    aria-label="Copiar link do formulário"
                  >
                    <Link2 className="h-3 w-3" />
                  </button>
                )}
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span className="text-[11px]">{timeLabel}</span>
                </div>
              </div>
            </div>

            {/* Title */}
            <p className="font-medium text-sm leading-snug">{deal.title}</p>

            {/* Value + badges */}
            <div className="flex items-center justify-between">
              {deal.value != null && deal.value > 0 ? (
                <span className="text-sm font-semibold text-primary">
                  R${" "}
                  {deal.value.toLocaleString("pt-BR", {
                    minimumFractionDigits: 0,
                  })}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Sem valor</span>
              )}

              <div className="flex items-center gap-1">
                {deal.formStatus && (
                  <Badge
                    variant={
                      deal.formStatus === "completo" ? "default" : "secondary"
                    }
                    className="text-[10px] h-5 px-1.5"
                  >
                    {deal.formStatus}
                  </Badge>
                )}
                {deal.hasContract && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                    <FileText className="h-3 w-3 mr-0.5" />
                    contrato
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
