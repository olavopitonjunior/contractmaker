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
import { OnboardingSidebarChecklist } from "@/components/onboarding/OnboardingSidebarChecklist";
import type { OnboardingStatus } from "@/lib/onboarding/status";
import { FEATURE, isValidModule } from "@/lib/modules/catalog";
import {
  LayoutDashboard,
  BookOpen,
  FileStack,
  Settings,
  LogOut,
  Wallet,
  Building2,
  Handshake,
  BarChart3,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

/** Chave de módulo OU sub-função que gateia a visibilidade do item na sidebar.
 *  Um array = anyOf (visível se QUALQUER uma estiver ligada) — ex.: Propostas,
 *  que aparece se vendas.propostas OU locacao.propostas. */
type Requires = string | string[];
type SubItem = { title: string; url: string; exact?: boolean; requires?: Requires };
type NavSimple = {
  kind: "item";
  title: string;
  url: string;
  icon: LucideIcon;
  requires?: Requires;
};
type NavGroup = {
  kind: "group";
  title: string;
  icon: LucideIcon;
  /** Gate de módulo/feature do grupo inteiro (além do filtro por sub-item). */
  requires?: Requires;
  items: SubItem[];
};
type NavEntry = NavSimple | NavGroup;

/** View serializável dos entitlements (vinda do server via props). */
type ModulesView = {
  enabled: Record<string, boolean>;
  features: Record<string, boolean>;
} | null;

/**
 * `requires` ausente => sempre visível (itens compartilhados). `modules` null
 * (sem org) => fail-open. Module key vs feature key distinguidos por isValidModule.
 */
function requiresEnabled(modules: ModulesView, requires?: Requires): boolean {
  if (!requires) return true;
  if (!modules) return true;
  // Array = anyOf.
  if (Array.isArray(requires)) {
    return requires.some((r) => requiresEnabled(modules, r));
  }
  return isValidModule(requires)
    ? modules.enabled[requires] === true
    : modules.features[requires] === true;
}

const NAV: NavEntry[] = [
  {
    kind: "group",
    title: "Pipeline",
    icon: LayoutDashboard,
    items: [
      { title: "Vendas", url: "/pipeline", exact: true, requires: FEATURE.VENDAS_PIPELINE },
      { title: "Locação", url: "/pipeline/locacao", requires: FEATURE.LOCACAO_PIPELINE },
      {
        title: "Propostas",
        url: "/pipeline/propostas",
        requires: [FEATURE.VENDAS_PROPOSTAS, FEATURE.LOCACAO_PROPOSTAS],
      },
    ],
  },
  {
    kind: "group",
    title: "ADM Locação",
    icon: Building2,
    // Grupo inteiro gateado pela sub-função "locacao.adm" (false quando o módulo
    // locação está desabilitado); cada sub-item é filtrado pela respectiva sub-função.
    requires: FEATURE.LOCACAO_ADM,
    items: [
      { title: "Dashboard", url: "/locacao", exact: true },
      { title: "Imóveis", url: "/locacao/imoveis" },
      { title: "Contratos", url: "/locacao/contratos", requires: FEATURE.LOCACAO_CONTRATOS },
      { title: "Cobranças", url: "/locacao/cobrancas", requires: FEATURE.LOCACAO_COBRANCAS },
      { title: "Repasses", url: "/locacao/repasses", requires: FEATURE.LOCACAO_REPASSES },
      { title: "Despesas", url: "/locacao/despesas", requires: FEATURE.LOCACAO_DESPESAS },
      { title: "Vistorias", url: "/locacao/vistorias", requires: FEATURE.LOCACAO_VISTORIAS },
      { title: "Clientes", url: "/locacao/pessoas/clientes", requires: FEATURE.LOCACAO_PESSOAS },
      { title: "Pessoas", url: "/locacao/pessoas", requires: FEATURE.LOCACAO_PESSOAS },
      { title: "Seguros", url: "/locacao/seguros", requires: FEATURE.LOCACAO_SEGUROS },
      { title: "Newton", url: "/locacao/newton", requires: FEATURE.LOCACAO_NEWTON },
    ],
  },
  {
    kind: "group",
    title: "Cláusulas",
    icon: BookOpen,
    items: [
      { title: "Banco de cláusulas", url: "/clauses", exact: true },
      { title: "Sugestões de cláusula", url: "/clauses/proposals" },
    ],
  },
  { kind: "item", title: "Templates", url: "/templates", icon: FileStack },
  { kind: "item", title: "Corretores", url: "/corretores", icon: Handshake },
  {
    kind: "group",
    title: "Relatórios",
    icon: BarChart3,
    items: [
      {
        title: "Origem dos negócios",
        url: "/relatorios/funil",
        requires: [FEATURE.VENDAS_PIPELINE, FEATURE.LOCACAO_PIPELINE],
      },
    ],
  },
  {
    kind: "group",
    title: "Financeiro",
    icon: Wallet,
    requires: FEATURE.VENDAS_PAGADORIA,
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
  modules?: ModulesView;
  /** Status do onboarding (só pra owner em aberto) — renderiza o checklist no topo. */
  onboarding?: OnboardingStatus | null;
  /** Marca da imobiliária: com logo cadastrado, ela assume o topo da sidebar. */
  brand?: { logoUrl: string | null; displayName: string } | null;
}

function isItemActive(pathname: string, item: SubItem): boolean {
  return item.exact
    ? pathname === item.url
    : pathname === item.url || pathname.startsWith(item.url + "/");
}

export function AppSidebar({
  user,
  modules = null,
  onboarding = null,
  brand = null,
}: AppSidebarProps) {
  const pathname = usePathname();
  // Override manual de abertura por grupo; quando indefinido, deriva da rota ativa.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});

  // Filtra a navegação pelos entitlements da org: itens com `requires` só
  // aparecem se o módulo/sub-função estiver habilitado; grupos somem se não
  // sobrar nenhum filho visível.
  const visibleNav = NAV.flatMap((entry): NavEntry[] => {
    if (entry.kind === "item") {
      return requiresEnabled(modules, entry.requires) ? [entry] : [];
    }
    if (!requiresEnabled(modules, entry.requires)) return [];
    const items = entry.items.filter((it) => requiresEnabled(modules, it.requires));
    return items.length > 0 ? [{ ...entry, items }] : [];
  });

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
          <BrandWordmark
            markClassName="text-primary"
            logoUrl={brand?.logoUrl}
            displayName={brand?.displayName}
          />
          <span className="mt-0.5 block pl-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {brand?.logoUrl ? "" : "Legaltech Solutions"}
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {onboarding && (
          <OnboardingSidebarChecklist status={onboarding} modules={modules} />
        )}
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNav.map((entry) => {
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
                      <ChevronRight
                        className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                          isOpen ? "rotate-90" : ""
                        }`}
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
