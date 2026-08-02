"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  /** Só aparece pra super_admin (a página redireciona os demais de qualquer forma). */
  superAdminOnly?: boolean;
}

/**
 * Itens em ordem de uso, não alfabética: orgs é a porta de entrada, agentes e
 * base são o dia a dia, staff é raro. "Métricas" entra quando /admin/metrics
 * existir — link morto no nav é pior que link nenhum.
 */
const ITEMS: NavItem[] = [
  { href: "/admin/orgs", label: "Organizações" },
  { href: "/admin/agents", label: "Agentes de IA" },
  { href: "/admin/knowledge", label: "Base de conhecimento" },
  { href: "/admin/support-ai", label: "IA de Suporte" },
  { href: "/admin/platform-roles", label: "Staff", superAdminOnly: true },
];

export function AdminNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-6">
        <span className="mr-3 shrink-0 py-3 text-sm font-semibold">Admin</span>
        {ITEMS.filter((i) => isSuperAdmin || !i.superAdminOnly).map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "shrink-0 border-b-2 px-3 py-3 text-sm transition-colors",
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
