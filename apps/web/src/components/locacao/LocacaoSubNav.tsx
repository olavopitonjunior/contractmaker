"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LOCACAO_SIMPLIFIED_MODE } from "@/lib/env/flags";

type SubNavItem = { label: string; href: string; exact?: boolean };

const FULL_SUB_NAV: SubNavItem[] = [
  { label: "Dashboard", href: "/locacao", exact: true },
  { label: "Imóveis", href: "/locacao/imoveis" },
  { label: "Esteira", href: "/locacao/esteira" },
  { label: "Contratos", href: "/locacao/contratos" },
  { label: "Cobranças", href: "/locacao/cobrancas" },
  { label: "Repasses", href: "/locacao/repasses" },
  { label: "Despesas", href: "/locacao/despesas" },
  { label: "Vistorias", href: "/locacao/vistorias" },
  { label: "Pessoas", href: "/locacao/pessoas" },
  { label: "Seguros", href: "/locacao/seguros" },
  { label: "Newton", href: "/locacao/newton" },
];

// Modo simplificado: só a esteira (fluxo form → contrato → assinatura).
const SIMPLIFIED_SUB_NAV: SubNavItem[] = [
  { label: "Esteira", href: "/locacao/esteira" },
];

const SUB_NAV: SubNavItem[] = LOCACAO_SIMPLIFIED_MODE
  ? SIMPLIFIED_SUB_NAV
  : FULL_SUB_NAV;

/**
 * Sub-nav horizontal scrollable — mobile-first.
 * Pills com active state derivado de pathname (exact match pra dashboard, prefix pros outros).
 * Touch targets ≥44px de altura.
 */
export function LocacaoSubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="-mx-2 flex gap-1 overflow-x-auto px-2 pb-1 sm:mx-0 sm:px-0"
      aria-label="Navegação Locação"
    >
      {SUB_NAV.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
