"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { Archive, Hourglass, Search, X } from "lucide-react";
import { toast } from "sonner";
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
import { AGING_WARN_DAYS, isStaleDeal } from "@/lib/pipeline/stage-config";
import { normalizeSearch } from "@/lib/format/text";
import { KanbanColumn } from "./KanbanColumn";
import {
  KanbanCard,
  type DealCard,
  type KanbanCardConfig,
  DEFAULT_CARD_CONFIG,
} from "./KanbanCard";
import { MilestoneDateDialog } from "./MilestoneDateDialog";

const ALL_MANAGERS = "__all__";

/**
 * Stages que fixam uma data-marco. `cardKey` = campo da derivada no card (pra
 * detectar se já existe data, ex. assinatura feita no sistema); `apiField` =
 * coluna manual enviada no PATCH; `label` = texto do diálogo.
 */
export type MilestoneFields = Record<
  string,
  { cardKey: keyof DealCard; apiField: string; label: string }
>;

const VENDA_MILESTONE_FIELDS: MilestoneFields = {
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

/** Config completa do board por esteira (card + stage perdido + marcos de data). */
export interface KanbanBoardConfig extends KanbanCardConfig {
  /** Nome do stage terminal "perdido" (renderizado separado). undefined = sem coluna de perdidos. */
  lostStageName?: string;
  /** Stages que pedem data-marco ao receber um card via drag. */
  milestoneFields: MilestoneFields;
}

const DEFAULT_BOARD_CONFIG: KanbanBoardConfig = {
  ...DEFAULT_CARD_CONFIG,
  lostStageName: "Negócio perdido",
  milestoneFields: VENDA_MILESTONE_FIELDS,
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
  config?: KanbanBoardConfig;
  /**
   * Instante do render do server (epoch ms). Rótulos relativos ("2d", aging)
   * derivam DESTE valor serializado — Date.now() no render do client divergiria
   * do HTML do server e quebraria a hidratação (React #418). Obrigatório de
   * propósito: um caller sem nowMs reintroduziria o bug em silêncio.
   */
  nowMs: number;
}

export function KanbanBoard({
  stages: initialStages,
  config = DEFAULT_BOARD_CONFIG,
  nowMs,
}: KanbanBoardProps) {
  const [stages, setStages] = useState(initialStages);
  const [activeCard, setActiveCard] = useState<DealCard | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMilestoneMove | null>(null);
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState(ALL_MANAGERS);
  const [onlyStale, setOnlyStale] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const showArchived = searchParams.get("arquivados") === "1";

  const debouncedSearch = useDebounce(search, 300);
  const query = normalizeSearch(debouncedSearch.trim());
  const hasClientFilter =
    query !== "" || managerFilter !== ALL_MANAGERS || onlyStale;

  const managers = useMemo(() => {
    const names = new Set<string>();
    for (const stage of stages) {
      for (const deal of stage.deals) {
        if (deal.managerName) names.add(deal.managerName);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [stages]);

  const filteredStages = useMemo(() => {
    if (!hasClientFilter) return stages;
    return stages.map((stage) => ({
      ...stage,
      deals: stage.deals.filter((deal) => {
        // Card com diálogo de data-marco aberto fica sempre visível — o move
        // otimista pode tê-lo levado a um stage que o filtro esconderia, e o
        // diálogo não pode perguntar sobre um card que sumiu da tela.
        if (pendingMove && deal.id === pendingMove.dealId) return true;
        if (query) {
          const haystack = normalizeSearch(
            `${deal.title} ${deal.clientName ?? ""} ${deal.managerName ?? ""}`
          );
          if (!haystack.includes(query)) return false;
        }
        if (managerFilter !== ALL_MANAGERS && deal.managerName !== managerFilter)
          return false;
        if (onlyStale) {
          // Mesma preferência do badge do KanbanCard: slaStatus do server
          // (política por org) > regra fixa isStaleDeal (caller legado).
          const stale =
            deal.slaStatus !== undefined
              ? deal.slaStatus === "atencao" || deal.slaStatus === "atrasado"
              : isStaleDeal(deal, stage.name, nowMs);
          if (!stale) return false;
        }
        return true;
      }),
    }));
  }, [stages, hasClientFilter, query, managerFilter, onlyStale, nowMs, pendingMove]);

  const totalDeals = useMemo(
    () => stages.reduce((sum, s) => sum + s.deals.length, 0),
    [stages]
  );
  const filteredDeals = filteredStages.reduce(
    (sum, s) => sum + s.deals.length,
    0
  );

  function toggleArchived() {
    const params = new URLSearchParams(searchParams.toString());
    if (showArchived) params.delete("arquivados");
    else params.set("arquivados", "1");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Sincroniza com novos dados do servidor (após router.refresh) sem descartar
  // moves otimistas pendentes.
  useEffect(() => setStages(initialStages), [initialStages]);

  /** Retorna se o PATCH persistiu — quem chama reverte o move otimista se não. */
  async function persistStageChange(
    dealId: string,
    targetStageId: string,
    extra?: Record<string, string>
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/pipeline/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: targetStageId, ...extra }),
      });
      return res.ok;
    } catch {
      return false;
    }
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
    const milestone = targetStage
      ? config.milestoneFields[targetStage.name]
      : undefined;
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

    const ok = await persistStageChange(dealId, targetStageId);
    if (!ok) {
      setStages(snapshot);
      toast.error("Não foi possível mover o negócio. Tente novamente.");
    }
  }

  async function handleMilestoneConfirm(isoDate: string) {
    const move = pendingMove;
    setPendingMove(null);
    if (!move) return;
    const ok = await persistStageChange(move.dealId, move.targetStageId, {
      [move.apiField]: isoDate,
    });
    if (!ok) {
      setStages(move.snapshot);
      toast.error("Não foi possível mover o negócio. Tente novamente.");
      return;
    }
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
      <div className="space-y-3">
        {/* Toolbar: busca + filtros client-side + toggle de arquivados (server) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar negócio..."
              className="h-9 w-64 max-w-full pl-8 pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {managers.length > 0 && (
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue placeholder="Gerente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_MANAGERS}>Todos os gerentes</SelectItem>
                {managers.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant={onlyStale ? "secondary" : "outline"}
            size="sm"
            className="h-9"
            aria-pressed={onlyStale}
            onClick={() => setOnlyStale((v) => !v)}
            title={`Só negócios sem mudança de estágio há ${AGING_WARN_DAYS}+ dias`}
          >
            <Hourglass className="mr-1.5 h-3.5 w-3.5" />
            Só parados
          </Button>
          <Button
            variant={showArchived ? "secondary" : "outline"}
            size="sm"
            className="h-9"
            aria-pressed={showArchived}
            onClick={toggleArchived}
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            {showArchived ? "Ocultar arquivados" : "Mostrar arquivados"}
          </Button>
          {hasClientFilter && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {filteredDeals} de {totalDeals}{" "}
              {totalDeals === 1 ? "negócio" : "negócios"}
            </span>
          )}
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4">
          {filteredStages
            .filter((s) => s.name !== config.lostStageName)
            .map((stage) => (
              <KanbanColumn
                key={stage.id}
                id={stage.id}
                name={stage.name}
                color={stage.color}
                deals={stage.deals}
                config={config}
                nowMs={nowMs}
                isFiltering={hasClientFilter}
              />
            ))}
          {config.lostStageName &&
            filteredStages.find((s) => s.name === config.lostStageName) && (
              <>
                <div
                  aria-hidden
                  className="self-stretch border-l border-muted mx-1"
                />
                {(() => {
                  const lost = filteredStages.find(
                    (s) => s.name === config.lostStageName
                  )!;
                  return (
                    <KanbanColumn
                      key={lost.id}
                      id={lost.id}
                      name={lost.name}
                      color={lost.color}
                      deals={lost.deals}
                      isLost
                      config={config}
                      nowMs={nowMs}
                      isFiltering={hasClientFilter}
                    />
                  );
                })()}
              </>
            )}
        </div>
      </div>
      <DragOverlay>
        {activeCard ? (
          <KanbanCard deal={activeCard} isOverlay config={config} nowMs={nowMs} />
        ) : null}
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
