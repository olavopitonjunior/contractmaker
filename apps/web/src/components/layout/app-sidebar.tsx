"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandWordmark } from "@/components/layout/brand-mark";
import { LOCACAO_SIMPLIFIED_MODE } from "@/lib/env/flags";
import {
  LayoutDashboard,
  BookOpen,
  FileStack,
  Settings,
  LogOut,
  Wallet,
  Building2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

type SubItem = { title: string; url: string; exact?: boolean };
type NavSimple = { kind: "item"; title: string; url: string; icon: LucideIcon };
type NavGroup = {
  kind: "group";
  title: string;
  icon: LucideIcon;
  /** Rótulo "Em Breve" exibido ao lado do grupo (módulo ainda não liberado). */
  comingSoon?: boolean;
  items: SubItem[];
};
type NavEntry = NavSimple | NavGroup;

const NAV: NavEntry[] = [
  {
    kind: "group",
    title: "Pipeline",
    icon: LayoutDashboard,
    items: [
      { title: "Vendas", url: "/pipeline", exact: true },
      { title: "Locação", url: "/pipeline/locacao" },
    ],
  },
  {
    kind: "group",
    title: "ADM Locação",
    icon: Building2,
    // Em staging (modo simplificado) o admin de locação ainda não é o foco.
    comingSoon: LOCACAO_SIMPLIFIED_MODE,
    items: [
      { title: "Dashboard", url: "/locacao", exact: true },
      { title: "Imóveis", url: "/locacao/imoveis" },
      { title: "Contratos", url: "/locacao/contratos" },
      { title: "Cobranças", url: "/locacao/cobrancas" },
      { title: "Repasses", url: "/locacao/repasses" },
      { title: "Despesas", url: "/locacao/despesas" },
      { title: "Vistorias", url: "/locacao/vistorias" },
      { title: "Pessoas", url: "/locacao/pessoas" },
      { title: "Seguros", url: "/locacao/seguros" },
      { title: "Newton", url: "/locacao/newton" },
    ],
  },
  {
    kind: "group",
    title: "Cláusulas",
    icon: BookOpen,
    items: [
      { title: "Banco de cláusulas", url: "/clauses", exact: true },
      { title: "Propostas", url: "/clauses/proposals" },
    ],
  },
  { kind: "item", title: "Templates", url: "/templates", icon: FileStack },
  {
    kind: "group",
    title: "Financeiro",
    icon: Wallet,
    items: [
      { title: "Cobranças", url: "/financeiro/cobrancas" },
      { title: "Clientes", url: "/financeiro/clientes" },
      { title: "Conciliação", url: "/financeiro/conciliacao" },
      { title: "Extrato", url: "/financeiro/extrato" },
      { title: "Transferências", url: "/financeiro/transferencias" },
      { title: "Relatórios", url: "/financeiro/relatorios" },
    ],
  },
  {
    kind: "group",
    title: "Configurações",
    icon: Settings,
    items: [
      { title: "Meu perfil", url: "/settings/profile" },
      { title: "Membros", url: "/settings/membros" },
      { title: "Segurança", url: "/settings/seguranca" },
      { title: "Base de conhecimento", url: "/settings/knowledge-base" },
      { title: "Estilos de documento", url: "/settings/document-styles" },
      { title: "Formulário", url: "/settings/formulario" },
      { title: "Contas bancárias", url: "/settings/pagamentos/contas" },
      { title: "Destinatários de split", url: "/settings/pagamentos/split-recipients" },
      { title: "Assinaturas", url: "/settings/signatures" },
      { title: "Certidões", url: "/settings/certidoes" },
      { title: "Uso de IA", url: "/settings/ai-usage" },
      { title: "API tokens", url: "/settings/api-tokens" },
      { title: "Uso da API", url: "/settings/api-usage" },
    ],
  },
];

interface AppSidebarProps {
  user: {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
  };
}

function isItemActive(pathname: string, item: SubItem): boolean {
  return item.exact
    ? pathname === item.url
    : pathname === item.url || pathname.startsWith(item.url + "/");
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  // Override manual de abertura por grupo; quando indefinido, deriva da rota ativa.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <Link href="/pipeline" className="block">
          <BrandWordmark markClassName="text-primary" />
          <span className="mt-0.5 block pl-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Legaltech Solutions
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((entry) => {
                if (entry.kind === "item") {
                  return (
                    <SidebarMenuItem key={entry.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname.startsWith(entry.url)}
                      >
                        <Link href={entry.url}>
                          <entry.icon className="h-4 w-4" />
                          <span>{entry.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                const hasActiveChild = entry.items.some((it) =>
                  isItemActive(pathname, it)
                );
                const isOpen = openOverride[entry.title] ?? hasActiveChild;

                return (
                  <SidebarMenuItem key={entry.title}>
                    <SidebarMenuButton
                      isActive={hasActiveChild}
                      onClick={() =>
                        setOpenOverride((prev) => ({
                          ...prev,
                          [entry.title]: !isOpen,
                        }))
                      }
                    >
                      <entry.icon className="h-4 w-4" />
                      <span>{entry.title}</span>
                      {entry.comingSoon && (
                        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Em breve
                        </span>
                      )}
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                          entry.comingSoon ? "ml-1" : "ml-auto"
                        } ${isOpen ? "rotate-90" : ""}`}
                      />
                    </SidebarMenuButton>
                    {isOpen && (
                      <SidebarMenuSub>
                        {entry.items.map((sub) => (
                          <SidebarMenuSubItem key={sub.url}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isItemActive(pathname, sub)}
                            >
                              <Link href={sub.url}>
                                <span>{sub.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <Link
          href="/settings/profile"
          className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-accent transition"
          aria-label="Editar perfil"
        >
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {user.name || user.email}
            </p>
            {user.name && (
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            )}
          </div>
        </Link>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/logout" aria-label="Sair">
                <LogOut className="h-4 w-4" />
                <span>Sair</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
