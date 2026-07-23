import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROPOSAL_TIMELINE, proposalTimelineStage } from "@/lib/proposals/status-view";

/**
 * Linha do tempo horizontal da jornada da proposta. Nós alcançados ficam
 * preenchidos (primary); o atual ganha um anel; futuros ficam apagados. Terminal
 * negativo (recusa/expiração/cancelamento) pinta o último nó de vermelho.
 */
export function ProposalProgressTimeline({ status }: { status: string }) {
  const { reachedIndex, negative } = proposalTimelineStage(status);

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {PROPOSAL_TIMELINE.map((node, i) => {
        const reached = i <= reachedIndex;
        const isCurrent = i === reachedIndex;
        const deadHead = negative && isCurrent;
        return (
          <div key={node.key} className="flex items-start">
            {i > 0 && (
              <div
                className={cn(
                  "mt-3 h-0.5 w-6 shrink-0 sm:w-12",
                  i <= reachedIndex ? "bg-primary" : "bg-border"
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
                  deadHead && "border-destructive bg-destructive text-destructive-foreground ring-4 ring-destructive/15"
                )}
              >
                {reached && !deadHead ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-center text-[10px] leading-tight",
                  reached ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {node.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
