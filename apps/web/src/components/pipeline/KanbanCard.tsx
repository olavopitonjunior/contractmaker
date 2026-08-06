"use client";

import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  FileText,
  Clock,
  Home,
  Link2,
  XOctagon,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { formPublicPath } from "@/lib/forms/form-url";
import { formatMoneyBR } from "@/lib/format/money";
import { formatDayMonthBR } from "@/lib/format/datetime";
import {
  DealProgressTimeline,
  type PipelineKind,
} from "@/components/pipeline/DealProgressTimeline";
import {
  AGING_DANGER_DAYS,
  daysInStage,
  isStaleDeal,
} from "@/lib/pipeline/stage-config";
import type { SlaStatus } from "@/lib/pipeline/sla";

/**
 * Config que adapta o card por esteira. Default = vendas (mantém comportamento
 * atual). Locação injeta basePath + timelineKind próprios.
 */
export interface KanbanCardConfig {
  /** Base do link de detalhe do deal. Default "/deals". */
  basePath: string;
  /** Esteira que define os nós da timeline. Default "venda". */
  timelineKind: PipelineKind;
}

export const DEFAULT_CARD_CONFIG: KanbanCardConfig = {
  basePath: "/deals",
  timelineKind: "venda",
};

export interface DealCard {
  id: string;
  title: string;
  value: number | null;
  createdAt: string;
  clientName: string | null;
  /** Gerente responsável (nome ou e-mail) — opcional pra retrocompat de callers. */
  managerName?: string | null;
  formStatus: string | null;
  formToken: string | null;
  hasContract: boolean;
  // Timeline SLA — datas-marco do funil
  formOpenedAt: string | null;
  formCompletedAt: string | null;
  contractSignedAt: string | null;
  chargeCreatedAt: string | null;
  commissionPaidAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  /** Quando o deal entrou no stage atual (aging). Null = usa createdAt. */
  stageEnteredAt?: string | null;
  /**
   * Status de SLA computado no SERVER (toDealCard — política por org via
   * slaWarnAt/slaDueAt materializados). `null` = sem SLA (terminal/perdido/
   * desabilitado); `undefined` = caller legado → fallback isStaleDeal (5/10).
   */
  slaStatus?: SlaStatus | null;
  /** Dias no stage atual, computado no server junto com slaStatus. */
  daysInStage?: number;
}

interface KanbanCardProps {
  deal: DealCard;
  isOverlay?: boolean;
  /** Nome do stage da coluna — destaca o nó atual da timeline. */
  currentStageName?: string | null;
  config?: KanbanCardConfig;
  /**
   * Instante do render do server (epoch ms) — rótulos relativos derivam dele
   * pra server e client renderizarem o mesmo texto (hidratação, React #418).
   * Obrigatório: caller sem nowMs reintroduziria o bug em silêncio.
   */
  nowMs: number;
}

export function KanbanCard({
  deal,
  isOverlay,
  currentStageName = null,
  config = DEFAULT_CARD_CONFIG,
  nowMs,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  const msAgo = nowMs - new Date(deal.createdAt).getTime();
  const hoursAgo = Math.floor(msAgo / 3600000);
  const daysAgo = Math.floor(msAgo / 86400000);
  const timeLabel = daysAgo > 0 ? `${daysAgo}d` : hoursAgo > 0 ? `${hoursAgo}h` : "agora";

  // Aging por stage — badge só quando acionável, pra não poluir cards
  // saudáveis. Preferência: slaStatus do server (política de SLA por org);
  // caller legado sem o campo cai na regra fixa stage-config::isStaleDeal
  // (o filtro "Só parados" do board usa a mesma preferência).
  const staleDays =
    deal.daysInStage ?? daysInStage(deal.stageEnteredAt, deal.createdAt, nowMs);
  const slaStatus: SlaStatus | null =
    deal.slaStatus !== undefined
      ? deal.slaStatus
      : isStaleDeal(deal, currentStageName, nowMs)
        ? staleDays >= AGING_DANGER_DAYS
          ? "atrasado"
          : "atencao"
        : null;
  const showAging = slaStatus === "atencao" || slaStatus === "atrasado";
  const agingDanger = slaStatus === "atrasado";

  function handleCopyFormLink(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!deal.formToken) return;
    const url = `${window.location.origin}${formPublicPath(deal.formToken, deal.title)}`;
    navigator.clipboard.writeText(url);
    toast.success("Link do formulário copiado!");
  }

  const isLost = !!deal.lostAt;

  // Separa o código do imóvel ("Cód: 20477 ...") do restante do título.
  const codeMatch = deal.title.match(/^c[oó]d\.?\s*:?\s*(\d+)\s*[-–—]?\s*/i);
  const dealCode = codeMatch?.[1] ?? null;
  const displayTitle = dealCode
    ? deal.title.slice(codeMatch![0].length).trim() || deal.title
    : deal.title;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-deal-id={deal.id}
      className={cn("rounded-md transition-all", isDragging && "opacity-40")}
    >
      <Link href={`${config.basePath}/${deal.id}`}>
        <Card
          className={cn(
            "cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/30 transition-all",
            isOverlay && "shadow-xl rotate-1 scale-105",
            isLost && "border-red-300 bg-red-50/30 dark:bg-red-950/10"
          )}
        >
          <CardContent className="p-3 space-y-2.5">
            {/* Top row: icon + time */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-medium">
                  Imóvel{dealCode && ` #${dealCode}`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {showAging && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium",
                      agingDanger
                        ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                    )}
                    title={`Sem mudança de estágio há ${staleDays} dia(s)`}
                  >
                    {staleDays}d parado
                  </span>
                )}
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

            {/* Title + cliente + gerente */}
            <div className="space-y-0.5">
              <p className="font-medium text-sm leading-snug">{displayTitle}</p>
              {deal.clientName && (
                <p className="text-[11px] text-muted-foreground leading-tight">
                  Cliente: {deal.clientName}
                </p>
              )}
              {deal.managerName && (
                <p
                  className="text-[11px] text-muted-foreground leading-tight truncate"
                  title={`Gerente: ${deal.managerName}`}
                >
                  Gerente: {deal.managerName}
                </p>
              )}
            </div>

            {/* Lost banner — substitui timeline quando perdido */}
            {isLost ? (
              <div className="flex items-start gap-1.5 rounded-md bg-red-100/60 dark:bg-red-950/30 px-2 py-1.5">
                <XOctagon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" />
                <div className="text-[10px] leading-tight">
                  <div className="font-medium text-red-700 dark:text-red-400">
                    Perdido em {formatDayMonthBR(deal.lostAt)}
                  </div>
                  {deal.lostReason && (
                    <div
                      className="text-red-700/70 dark:text-red-400/70 line-clamp-2"
                      title={deal.lostReason}
                    >
                      {deal.lostReason}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Timeline compacta — 6 stages + marcos SLA */
              <DealProgressTimeline
                variant="compact"
                kind={config.timelineKind}
                currentStageName={currentStageName}
                formOpenedAt={deal.formOpenedAt}
                formCompletedAt={deal.formCompletedAt}
                contractSignedAt={deal.contractSignedAt}
                chargeCreatedAt={deal.chargeCreatedAt}
                commissionPaidAt={deal.commissionPaidAt}
              />
            )}

            {/* Value + badges */}
            <div className="flex items-center justify-between">
              {deal.value != null && deal.value > 0 ? (
                <span className="text-sm font-semibold text-primary tabular-nums">
                  {formatMoneyBR(deal.value, { decimals: 0 })}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Sem valor</span>
              )}

              <div className="flex items-center gap-1">
                {deal.formStatus &&
                  (deal.formStatus === "completo" ? (
                    <Badge className="h-5 gap-0.5 border-success/20 bg-success/10 px-1.5 text-[10px] text-success hover:bg-success/10">
                      <Check className="h-3 w-3" />
                      Completo
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {deal.formStatus}
                    </Badge>
                  ))}
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
