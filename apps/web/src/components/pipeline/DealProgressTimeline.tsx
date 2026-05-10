"use client";

import { FileText, CheckCircle2, Send, PenLine, Receipt, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type DateLike = Date | string | null | undefined;

interface Props {
  /** Nome da stage atual no pipeline. Usado pra destacar a posição. */
  currentStageName?: string | null;
  formOpenedAt: DateLike;
  formCompletedAt: DateLike;
  /** Closed do envelope source="contract" — marco "contrato assinado". */
  contractSignedAt: DateLike;
  /** Primeira CommissionCharge — marco "cobrança gerada". */
  chargeCreatedAt: DateLike;
  /** Deal.commissionPaidAt — marco "comissão paga" (terminal feliz). */
  commissionPaidAt: DateLike;
  /** Compact = card kanban (sem labels); full = DealDetail (com labels e datas). */
  variant: "compact" | "full";
  className?: string;
}

interface NodeDef {
  key: string;
  label: string;
  shortLabel: string;
  Icon: typeof FileText;
  date: Date | null;
  /** Stages do pipeline que mapeiam pra "este node já foi atingido". */
  reachedAtStages: readonly string[];
}

function toDate(d: DateLike): Date | null {
  if (!d) return null;
  if (d instanceof Date) return d;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatShort(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatLong(d: Date | null): string {
  if (!d) return "Pendente";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STAGE_ORDER = [
  "Formulário",
  "Confecção de Contrato",
  "Enviado para assinatura",
  "Contrato assinado",
  "Cobrança emitida",
  "Comissão paga",
] as const;

function stageIndex(name: string | null | undefined): number {
  if (!name) return -1;
  return STAGE_ORDER.indexOf(name as (typeof STAGE_ORDER)[number]);
}

export function DealProgressTimeline(props: Props) {
  const {
    currentStageName,
    formOpenedAt,
    formCompletedAt,
    contractSignedAt,
    chargeCreatedAt,
    commissionPaidAt,
    variant,
    className,
  } = props;

  const currentIdx = stageIndex(currentStageName);

  const nodes: NodeDef[] = [
    {
      key: "form_open",
      label: "Form aberto",
      shortLabel: "Form",
      Icon: FileText,
      date: toDate(formOpenedAt),
      reachedAtStages: STAGE_ORDER,
    },
    {
      key: "form_done",
      label: "Form completo",
      shortLabel: "Conf",
      Icon: CheckCircle2,
      date: toDate(formCompletedAt),
      reachedAtStages: STAGE_ORDER.slice(1),
    },
    {
      key: "envio",
      label: "Enviado p/ assinatura",
      shortLabel: "Envio",
      Icon: Send,
      date: null,
      reachedAtStages: STAGE_ORDER.slice(2),
    },
    {
      key: "signed",
      label: "Contrato assinado",
      shortLabel: "Sign",
      Icon: PenLine,
      date: toDate(contractSignedAt),
      reachedAtStages: STAGE_ORDER.slice(3),
    },
    {
      key: "charge",
      label: "Cobrança gerada",
      shortLabel: "Cobr",
      Icon: Receipt,
      date: toDate(chargeCreatedAt),
      reachedAtStages: STAGE_ORDER.slice(4),
    },
    {
      key: "paid",
      label: "Comissão paga",
      shortLabel: "Pago",
      Icon: Wallet,
      date: toDate(commissionPaidAt),
      reachedAtStages: STAGE_ORDER.slice(5),
    },
  ];

  const states = nodes.map((n, idx): "reached" | "current" | "future" => {
    const reachedByStage =
      currentIdx >= 0 && n.reachedAtStages.includes(STAGE_ORDER[currentIdx]);
    const reachedByDate = n.date !== null;
    if (reachedByStage || reachedByDate) {
      return idx === currentIdx ? "current" : "reached";
    }
    if (idx === currentIdx + 1) return "current";
    return "future";
  });

  if (variant === "compact") {
    return (
      <TooltipProvider delayDuration={150}>
        <div className={cn("flex items-center gap-0.5 w-full", className)}>
          {nodes.map((n, idx) => {
            const state = states[idx];
            const Icon = n.Icon;
            return (
              <div key={n.key} className="flex items-center min-w-0 flex-1 last:flex-none">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "flex items-center justify-center h-5 w-5 rounded-full border shrink-0 cursor-help",
                        state === "reached" &&
                          "bg-primary/15 border-primary text-primary",
                        state === "current" &&
                          "bg-primary border-primary text-primary-foreground ring-2 ring-primary/30",
                        state === "future" &&
                          "border-muted-foreground/30 text-muted-foreground/50"
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <div className="font-medium">{n.label}</div>
                    <div className="text-muted-foreground">{formatLong(n.date)}</div>
                  </TooltipContent>
                </Tooltip>
                {idx < nodes.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 flex-1 mx-0.5",
                      states[idx + 1] !== "future"
                        ? "bg-primary/40"
                        : "bg-muted-foreground/20"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    );
  }

  // full variant
  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn("rounded-lg border bg-card p-3 sm:p-4", className)}>
        <div className="flex items-stretch w-full">
          {nodes.map((n, idx) => {
            const state = states[idx];
            const Icon = n.Icon;
            return (
              <div
                key={n.key}
                className="flex items-start min-w-0 flex-1 last:flex-none"
              >
                <div className="flex flex-col items-center gap-1 px-1 min-w-0 flex-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "flex items-center justify-center h-9 w-9 rounded-full border-2 shrink-0 cursor-help transition-colors",
                          state === "reached" &&
                            "bg-primary/15 border-primary text-primary",
                          state === "current" &&
                            "bg-primary border-primary text-primary-foreground ring-4 ring-primary/20",
                          state === "future" &&
                            "border-muted-foreground/30 text-muted-foreground/50"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div className="font-medium">{n.label}</div>
                      <div className="text-muted-foreground">
                        {formatLong(n.date)}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  <span
                    className={cn(
                      "text-[10px] sm:text-xs font-medium truncate w-full text-center",
                      state === "future"
                        ? "text-muted-foreground/60"
                        : "text-foreground"
                    )}
                  >
                    {n.shortLabel}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
                      n.date ? "text-muted-foreground" : "text-muted-foreground/40"
                    )}
                  >
                    {formatShort(n.date)}
                  </span>
                </div>
                {idx < nodes.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 flex-1 self-start mt-[18px] -mx-1 min-w-[8px]",
                      states[idx + 1] !== "future"
                        ? "bg-primary/40"
                        : "bg-muted-foreground/20"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
