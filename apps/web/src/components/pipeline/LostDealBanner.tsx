import { XOctagon } from "lucide-react";

interface LostDealBannerProps {
  lostAt: string | Date;
  lostReason?: string | null;
}

/** Banner vermelho de deal perdido — compartilhado entre DealDetail (venda) e
 *  LocacaoDealDetail. Substitui a timeline quando o deal está no terminal. */
export function LostDealBanner({ lostAt, lostReason }: LostDealBannerProps) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 px-4 py-3">
      <div className="flex items-start gap-3">
        <XOctagon className="h-5 w-5 mt-0.5 shrink-0 text-red-600" />
        <div className="flex-1">
          <p className="font-medium text-red-700 dark:text-red-400">
            Perdido em{" "}
            {new Date(lostAt).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
          </p>
          {lostReason && (
            <p className="text-sm text-red-700/80 dark:text-red-400/80 mt-0.5">
              {lostReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
