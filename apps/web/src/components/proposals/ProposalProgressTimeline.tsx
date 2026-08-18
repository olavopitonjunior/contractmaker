import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROPOSAL_TIMELINE, proposalTimelineStage } from "@/lib/proposals/status-view";

/**
 * Linha do tempo horizontal da jornada da proposta. Nós alcançados ficam
 * preenchidos (primary); o atual ganha um anel; futuros ficam apagados. Terminal
 * negativo (recusa/expiração/cancelamento) pinta o último nó de vermelho.
 *
 * 2026-08 (parada de decisão):
 *  - `vendedorIncluded=false` OMITE o nó "Proprietário" — proposta sem
 *    vendedor nunca passa por ele e o nó apagado lia como etapa faltando;
 *  - em `assinada_proponente` o nó "Proprietário" ganha anel TRACEJADO âmbar
 *    ("sua vez"): a jornada não anda sozinha dali — espera a decisão do
 *    corretor (enviar a 2ª via ou concluir sem enviar).
 */
export function ProposalProgressTimeline({
  status,
  vendedorIncluded = true,
  vendedorSkipped = false,
}: {
  status: string;
  vendedorIncluded?: boolean;
  /**
   * Concluída SEM enviar a via do proprietário (caminho B da decisão) — o nó
   * "Proprietário" vira "Não enviada" apagado em vez de check: ele nunca
   * assinou, e o check sugeria que sim (achado de QA 2026-08-18).
   */
  vendedorSkipped?: boolean;
}) {
  const { reachedIndex, negative } = proposalTimelineStage(status);
  const awaitingDecision = status === "assinada_proponente" && vendedorIncluded;

  const nodes = PROPOSAL_TIMELINE.map((node, originalIndex) => ({
    ...node,
    originalIndex,
  })).filter((n) => vendedorIncluded || n.key !== "vendedor");

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {nodes.map((node, i) => {
        const skippedNode = vendedorSkipped && node.key === "vendedor";
        const reached = node.originalIndex <= reachedIndex && !skippedNode;
        const isCurrent = node.originalIndex === reachedIndex;
        const deadHead = negative && isCurrent;
        const decisionNode = awaitingDecision && node.key === "vendedor";
        return (
          <div key={node.key} className="flex items-start">
            {i > 0 && (
              <div
                className={cn(
                  "mt-3 h-0.5 w-6 shrink-0 sm:w-12",
                  node.originalIndex <= reachedIndex ? "bg-primary" : "bg-border"
                )}
              />
            )}
            <div className="flex w-12 flex-col items-center gap-1 sm:w-14">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-medium",
                  reached
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground",
                  isCurrent && !deadHead && "ring-4 ring-primary/15",
                  deadHead && "border-destructive bg-destructive text-destructive-foreground ring-4 ring-destructive/15",
                  decisionNode &&
                    "border-dashed border-warning text-warning ring-4 ring-warning/15",
                  skippedNode && "border-dashed"
                )}
              >
                {reached && !deadHead ? (
                  <Check className="h-3 w-3" />
                ) : skippedNode ? (
                  "—"
                ) : (
                  node.originalIndex + 1
                )}
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-center text-[10px] leading-tight",
                  reached ? "text-foreground" : "text-muted-foreground",
                  decisionNode && "font-medium text-warning"
                )}
              >
                {skippedNode ? "Não enviada" : decisionNode ? "Sua vez" : node.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
