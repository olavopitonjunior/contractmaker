"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { MilestoneDateDialog } from "./MilestoneDateDialog";

/**
 * Stages que fixam uma data-marco. `cardKey` = campo da derivada no card (pra
 * detectar se já existe data, ex. assinatura feita no sistema); `apiField` =
 * coluna manual enviada no PATCH; `label` = texto do diálogo.
 */
const MILESTONE_FIELDS: Record<
  string,
  { cardKey: keyof DealCard; apiField: string; label: string }
> = {
  "Contrato assinado": {
    cardKey: "contractSignedAt",
    apiField: "contractSignedAt",
    label: "assinatura do contrato",
  },
  "Cobrança emitida": {
    cardKey: "chargeCreatedAt",
    apiField: "chargeIssuedAt",
    label: "emissão da cobrança",
  },
  "Comissão paga": {
    cardKey: "commissionPaidAt",
    apiField: "commissionPaidAt",
    label: "pagamento da comissão",
  },
};

interface PendingMilestoneMove {
  dealId: string;
  targetStageId: string;
  apiField: string;
  label: string;
  /** Estado do board antes do move otimista — restaurado se o usuário cancela. */
  snapshot: Stage[];
}

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
  const [pendingMove, setPendingMove] = useState<PendingMilestoneMove | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  // Sincroniza com novos dados do servidor (após router.refresh) sem descartar
  // moves otimistas pendentes.
  useEffect(() => setStages(initialStages), [initialStages]);

  async function persistStageChange(
    dealId: string,
    targetStageId: string,
    extra?: Record<string, string>
  ) {
    await fetch(`/api/pipeline/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: targetStageId, ...extra }),
    });
  }

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

    // Find current stage + card
    let sourceStageId = "";
    let dealCard: DealCard | undefined;
    for (const stage of stages) {
      const found = stage.deals.find((d) => d.id === dealId);
      if (found) {
        sourceStageId = stage.id;
        dealCard = found;
        break;
      }
    }

    if (sourceStageId === targetStageId) return;

    const targetStage = stages.find((s) => s.id === targetStageId);
    const milestone = targetStage ? MILESTONE_FIELDS[targetStage.name] : undefined;
    // Pede a data só quando a etapa NÃO foi feita no sistema (data-marco nula).
    const needsDate =
      !!milestone && dealCard ? !dealCard[milestone.cardKey] : false;

    // Snapshot para reverter caso o usuário cancele o diálogo de data.
    const snapshot = stages;

    // Optimistic update
    setStages((prev) => {
      const newStages = prev.map((stage) => ({
        ...stage,
        deals: [...stage.deals],
      }));

      const sourceStage = newStages.find((s) => s.id === sourceStageId);
      const target = newStages.find((s) => s.id === targetStageId);
      if (!sourceStage || !target) return prev;

      const dealIndex = sourceStage.deals.findIndex((d) => d.id === dealId);
      if (dealIndex === -1) return prev;

      const [deal] = sourceStage.deals.splice(dealIndex, 1);
      target.deals.push(deal);

      return newStages;
    });

    if (milestone && needsDate) {
      // Adia o PATCH até o usuário informar a data no diálogo.
      setPendingMove({
        dealId,
        targetStageId,
        apiField: milestone.apiField,
        label: milestone.label,
        snapshot,
      });
      return;
    }

    await persistStageChange(dealId, targetStageId);
  }

  async function handleMilestoneConfirm(isoDate: string) {
    const move = pendingMove;
    setPendingMove(null);
    if (!move) return;
    await persistStageChange(move.dealId, move.targetStageId, {
      [move.apiField]: isoDate,
    });
    // Atualiza os marcos derivados (dots da timeline) no próximo render server.
    router.refresh();
  }

  function handleMilestoneCancel() {
    if (pendingMove) setStages(pendingMove.snapshot);
    setPendingMove(null);
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
      <MilestoneDateDialog
        open={!!pendingMove}
        milestoneLabel={pendingMove?.label ?? ""}
        onConfirm={handleMilestoneConfirm}
        onCancel={handleMilestoneCancel}
      />
    </DndContext>
  );
}
