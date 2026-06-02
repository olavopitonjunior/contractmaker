"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { CommandTrigger } from "@/components/layout/command-palette";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { ThemeToggle } from "@/components/layout/theme-toggle";

// Label custom pra rotas top-level e algumas conhecidas. Slugs (ids cuid) e
// segmentos não mapeados caem no fallback "capitalizar".
const LABEL_MAP: Record<string, string> = {
  pipeline: "Pipeline de Vendas",
  locacao: "Locação",
  imoveis: "Imóveis",
  esteira: "Esteira",
  contratos: "Contratos",
  cobrancas: "Cobranças",
  repasses: "Repasses",
  despesas: "Despesas",
  vistorias: "Vistorias",
  newton: "Newton",
  pessoas: "Pessoas",
  proprietarios: "Proprietários",
  locatarios: "Locatários",
  fiadores: "Fiadores",
  forms: "Formulários",
  new: "Novo",
  deals: "Negócios",
  clauses: "Cláusulas",
  templates: "Templates",
  settings: "Configurações",
  financeiro: "Financeiro",
  cobranças: "Cobranças",
  clientes: "Clientes",
  conciliacao: "Conciliação",
  extrato: "Extrato",
  transferencias: "Transferências",
  relatorios: "Relatórios",
  onboarding: "Onboarding",
  certidoes: "Certidões",
  intents: "Aprovações",
  seguros: "Seguros",
};

interface Segment {
  label: string;
  href: string;
  isLast: boolean;
  isId: boolean;
}

function isIdLike(s: string): boolean {
  // cuid (cm... 24 chars) ou uuid
  return /^c[a-z0-9]{20,}$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
}

function buildSegments(pathname: string): Segment[] {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((slug, idx) => {
    const href = "/" + parts.slice(0, idx + 1).join("/");
    const isId = isIdLike(slug);
    const label = isId
      ? "Detalhe"
      : LABEL_MAP[slug.toLowerCase()] ?? capitalize(slug);
    return { label, href, isLast: idx === parts.length - 1, isId };
  });
}

export function DashboardHeader() {
  const pathname = usePathname();
  const segments = buildSegments(pathname);
  const isStaging = process.env.NEXT_PUBLIC_STAGING_MODE === "true";

  return (
    <>
      {isStaging && (
        <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-xs font-medium text-amber-950">
          <span aria-hidden>⚠️</span>
          Ambiente de homologação — dados podem ser apagados a qualquer momento. Não use com clientes reais.
        </div>
      )}
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 sm:px-6">
      <SidebarTrigger className="-ml-2" />
      <Separator orientation="vertical" className="h-6" />

      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden sm:inline-flex">
            <BreadcrumbLink asChild>
              <Link href="/">Início</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {segments.length > 0 && <BreadcrumbSeparator className="hidden sm:inline-flex" />}
          {segments.map((seg, idx) => (
            <BreadcrumbItem key={seg.href} className="min-w-0">
              {seg.isLast ? (
                <BreadcrumbPage className="truncate">{seg.label}</BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink asChild>
                    <Link href={seg.href} className="truncate">
                      {seg.label}
                    </Link>
                  </BreadcrumbLink>
                  {idx < segments.length - 1 && <BreadcrumbSeparator />}
                </>
              )}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-3">
        <CommandTrigger />
        <ThemeToggle />
        <NotificationsBell />
      </div>
    </header>
    </>
  );
}
