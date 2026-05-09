"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard, type DealCard } from "./KanbanCard";

interface Stage {
  id: string;
  name: string;
  color: string;
  deals: DealCard[];
}

interface KanbanBoardProps {
  stages: Stage[];
}

export function KanbanBoard({ stages: initialStages }: KanbanBoardProps) {
  const [stages, setStages] = useState(initialStages);
  const [activeCard, setActiveCard] = useState<DealCard | null>(null);
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Scroll para o card recem-criado e destacar por alguns segundos
  useEffect(() => {
    if (!highlightId) return;
    const el = document.querySelector(`[data-deal-id="${highlightId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2");
      const timer = setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "ring-offset-2");
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [highlightId]);

  function handleDragStart(event: DragStartEvent) {
    const dealId = event.active.id as string;
    for (const stage of stages) {
      const deal = stage.deals.find((d) => d.id === dealId);
      if (deal) {
        setActiveCard(deal);
        break;
      }
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const dealId = active.id as string;
    const targetStageId = over.id as string;

    // Find current stage
    let sourceStageId = "";
    for (const stage of stages) {
      if (stage.deals.find((d) => d.id === dealId)) {
        sourceStageId = stage.id;
        break;
      }
    }

    if (sourceStageId === targetStageId) return;

    // Optimistic update
    setStages((prev) => {
      const newStages = prev.map((stage) => ({
        ...stage,
        deals: [...stage.deals],
      }));

      const sourceStage = newStages.find((s) => s.id === sourceStageId);
      const targetStage = newStages.find((s) => s.id === targetStageId);
      if (!sourceStage || !targetStage) return prev;

      const dealIndex = sourceStage.deals.findIndex((d) => d.id === dealId);
      if (dealIndex === -1) return prev;

      const [deal] = sourceStage.deals.splice(dealIndex, 1);
      targetStage.deals.push(deal);

      return newStages;
    });

    // Persist to API
    await fetch(`/api/pipeline/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: targetStageId }),
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages
          .filter((s) => s.name !== "Negócio perdido")
          .map((stage) => (
            <KanbanColumn
              key={stage.id}
              id={stage.id}
              name={stage.name}
              color={stage.color}
              deals={stage.deals}
            />
          ))}
        {stages.find((s) => s.name === "Negócio perdido") && (
          <>
            <div
              aria-hidden
              className="self-stretch border-l border-muted mx-1"
            />
            {(() => {
              const lost = stages.find((s) => s.name === "Negócio perdido")!;
              return (
                <KanbanColumn
                  key={lost.id}
                  id={lost.id}
                  name={lost.name}
                  color={lost.color}
                  deals={lost.deals}
                  isLost
                />
              );
            })()}
          </>
        )}
      </div>
      <DragOverlay>
        {activeCard ? <KanbanCard deal={activeCard} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
