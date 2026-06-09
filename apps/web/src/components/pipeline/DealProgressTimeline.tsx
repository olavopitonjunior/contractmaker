"use client";

import {
  FileText,
  CheckCircle2,
  Send,
  PenLine,
  Receipt,
  Wallet,
  ClipboardCheck,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type DateLike = Date | string | null | undefined;

/** Esteira de vendas (default) ou de locação — muda o conjunto de nós e ordem de stages. */
export type PipelineKind = "venda" | "locacao";

interface Props {
  /** Esteira que define os nós da timeline. Default "venda". */
  kind?: PipelineKind;
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

/** De qual prop de data o nó deriva seu carimbo (null = sem data, só posição). */
type DateProp =
  | "formOpenedAt"
  | "formCompletedAt"
  | "contractSignedAt"
  | "chargeCreatedAt"
  | "commissionPaidAt"
  | null;

interface NodeBlueprint {
  key: string;
  label: string;
  shortLabel: string;
  Icon: typeof FileText;
  dateProp: DateProp;
}

interface NodeDef {
  key: string;
  label: string;
  shortLabel: string;
  Icon: typeof FileText;
  date: Date | null;
}

/**
 * Configuração por esteira: ordem dos stages do pipeline (índice ⇒ posição na
 * timeline) e os nós exibidos. O nó na posição `i` é considerado "atingido"
 * quando o índice do stage atual ≥ `i`, ou quando há data carimbada.
 */
const PIPELINE_CONFIG: Record<
  PipelineKind,
  { stageOrder: readonly string[]; nodes: readonly NodeBlueprint[] }
> = {
  venda: {
    stageOrder: [
      "Formulário",
      "Confecção de Contrato",
      "Enviado para assinatura",
      "Contrato assinado",
      "Cobrança emitida",
      "Comissão paga",
    ],
    nodes: [
      { key: "form_open", label: "Form aberto", shortLabel: "Form", Icon: FileText, dateProp: "formOpenedAt" },
      { key: "form_done", label: "Form completo", shortLabel: "Conf", Icon: CheckCircle2, dateProp: "formCompletedAt" },
      { key: "envio", label: "Enviado p/ assinatura", shortLabel: "Envio", Icon: Send, dateProp: null },
      { key: "signed", label: "Contrato assinado", shortLabel: "Sign", Icon: PenLine, dateProp: "contractSignedAt" },
      { key: "charge", label: "Cobrança gerada", shortLabel: "Cobr", Icon: Receipt, dateProp: "chargeCreatedAt" },
      { key: "paid", label: "Comissão paga", shortLabel: "Pago", Icon: Wallet, dateProp: "commissionPaidAt" },
    ],
  },
  locacao: {
    stageOrder: [
      "Em Aprovação",
      "Formulário",
      "Em contrato",
      "Assinado",
      "Cobrança Gerada",
      "ADM",
    ],
    nodes: [
      { key: "aprovacao", label: "Em aprovação", shortLabel: "Aprov", Icon: ClipboardCheck, dateProp: null },
      { key: "form", label: "Formulário", shortLabel: "Form", Icon: FileText, dateProp: "formOpenedAt" },
      { key: "contrato", label: "Em contrato", shortLabel: "Contr", Icon: PenLine, dateProp: "formCompletedAt" },
      { key: "assinado", label: "Assinado", shortLabel: "Sign", Icon: CheckCircle2, dateProp: "contractSignedAt" },
      { key: "cobranca", label: "Cobrança gerada", shortLabel: "Cobr", Icon: Receipt, dateProp: "chargeCreatedAt" },
      { key: "adm", label: "Administração", shortLabel: "ADM", Icon: Building2, dateProp: "commissionPaidAt" },
    ],
  },
};

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

export function DealProgressTimeline(props: Props) {
  const {
    kind = "venda",
    currentStageName,
    formOpenedAt,
    formCompletedAt,
    contractSignedAt,
    chargeCreatedAt,
    commissionPaidAt,
    variant,
    className,
  } = props;

  const config = PIPELINE_CONFIG[kind];
  const currentIdx = config.stageOrder.indexOf(currentStageName ?? "");

  const dateByProp: Record<NonNullable<DateProp>, Date | null> = {
    formOpenedAt: toDate(formOpenedAt),
    formCompletedAt: toDate(formCompletedAt),
    contractSignedAt: toDate(contractSignedAt),
    chargeCreatedAt: toDate(chargeCreatedAt),
    commissionPaidAt: toDate(commissionPaidAt),
  };

  const nodes: NodeDef[] = config.nodes.map((n) => ({
    key: n.key,
    label: n.label,
    shortLabel: n.shortLabel,
    Icon: n.Icon,
    date: n.dateProp ? dateByProp[n.dateProp] : null,
  }));

  const states = nodes.map((n, idx): "reached" | "current" | "future" => {
    if (idx === currentIdx) return "current";
    // Nó atingido quando o stage atual está nele ou além, ou já há data carimbada.
    const reachedByStage = currentIdx >= 0 && currentIdx >= idx;
    const reachedByDate = n.date !== null;
    if (reachedByStage || reachedByDate) return "reached";
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
