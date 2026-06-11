import Link from "next/link";
import { cn } from "@/lib/utils";

export type LeaseTab = "geral" | "seguros" | "garantias" | "vistoria";

interface Props {
  leaseId: string;
  active: LeaseTab;
  /** Tabs visíveis conforme entitlements da org (seguros/vistoria são gateadas). */
  tabs: Array<{ key: LeaseTab; label: string }>;
}

/** Nav de abas por Link (?tab=) — a página continua server component. */
export function LeaseTabsNav({ leaseId, active, tabs }: Props) {
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={
            t.key === "geral"
              ? `/locacao/contratos/${leaseId}`
              : `/locacao/contratos/${leaseId}?tab=${t.key}`
          }
          scroll={false}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            active === t.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
