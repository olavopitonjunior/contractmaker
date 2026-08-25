"use client";

import { Fragment } from "react";
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
import type { ModulesView } from "@/components/layout/app-sidebar";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { isDeadCrumb } from "@/components/layout/breadcrumb-routes";

// Label custom pra rotas top-level e algumas conhecidas. Slugs (ids cuid) e
// segmentos não mapeados caem no fallback "capitalizar".
const LABEL_MAP: Record<string, string> = {
  pipeline: "Pipeline",
  locacao: "ADM Locação",
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
  ingestion: "Envio de modelos",
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
  // Sem entrada aqui o fallback capitaliza o slug e sai "Ai agents".
  "ai-agents": "Agentes de IA",
  "ai-usage": "Uso de IA",
  "ai-insights": "AI Insights",
};

interface Segment {
  label: string;
  href: string;
  isLast: boolean;
  isId: boolean;
  /** Segmento sem page.tsx (ver breadcrumb-routes.ts) — vira texto, não link. */
  dead: boolean;
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
  const root = parts[0];
  // hrefs pré-computados: o parent de idx é hrefs[idx-1] — uma construção só,
  // sem duplicar o slice/join em dois pontos que teriam que evoluir juntos.
  const hrefs = parts.map((_, i) => "/" + parts.slice(0, i + 1).join("/"));
  return parts.map((slug, idx) => {
    const href = hrefs[idx];
    const isId = isIdLike(slug);
    // O segmento "locacao" é ambíguo: sob /pipeline é a esteira comercial
    // ("Locação"); sob /locacao é o módulo administrativo ("ADM Locação").
    let label: string;
    if (isId) {
      label = "Detalhe";
    } else if (slug === "locacao") {
      label = root === "pipeline" ? "Locação" : "ADM Locação";
    } else {
      label = LABEL_MAP[slug.toLowerCase()] ?? capitalize(slug);
    }
    const parentHref = hrefs[idx - 1] ?? "/";
    return {
      label,
      href,
      isLast: idx === parts.length - 1,
      isId,
      dead: isDeadCrumb(href, isId, parentHref),
    };
  });
}

export function DashboardHeader({
  tenantSwitcher,
  modules = null,
}: {
  /**
   * Slot do seletor de tenant (super_admin). Vem pronto do layout (server) —
   * este header é client e não deve consultar PlatformRole por conta própria.
   */
  tenantSwitcher?: React.ReactNode;
  /** Entitlements da org (mesma view da sidebar) — filtram os atalhos do ⌘K. */
  modules?: ModulesView;
}) {
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
          {/*
            O separador é IRMÃO do item, nunca filho. `BreadcrumbItem` e
            `BreadcrumbSeparator` são os dois `<li>`, e `<li>` dentro de `<li>`
            é HTML inválido: o parser do browser fecha o primeiro ao ver o
            segundo e monta os dois como irmãos. O React, que serializou
            aninhado, procura o `<li>` do separador dentro do item, não acha e
            aborta a hidratação — era a origem dos React #418 (um por segmento
            intermediário) + #423 em toda rota aninhada. Rota de um segmento só
            (ex.: /corretores) escapava porque o único segmento é `isLast` e não
            emite separador. Ver dashboard-header.hydration.test.tsx.
          */}
          {segments.map((seg) => (
            <Fragment key={seg.href}>
              <BreadcrumbItem className="min-w-0">
                {seg.isLast ? (
                  <BreadcrumbPage className="truncate">{seg.label}</BreadcrumbPage>
                ) : seg.dead ? (
                  // Sem page.tsx nem redirect no segmento: linkar daria 404
                  // (issue #320). role+aria-disabled seguem o precedente do
                  // BreadcrumbPage (ui/breadcrumb.tsx), sem aria-current —
                  // não é a página atual.
                  <span role="link" aria-disabled="true" className="truncate">
                    {seg.label}
                  </span>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={seg.href} className="truncate">
                      {seg.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!seg.isLast && <BreadcrumbSeparator />}
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-3">
        {tenantSwitcher}
        <CommandTrigger modules={modules} />
        <ThemeToggle />
        <NotificationsBell />
      </div>
    </header>
    </>
  );
}
