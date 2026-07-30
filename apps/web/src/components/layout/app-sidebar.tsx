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
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION, type PermissionKey } from "@/lib/security/rbac/permissions";
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
  ClipboardCheck,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

/** Chave de módulo OU sub-função que gateia a visibilidade do item na sidebar.
 *  Um array = anyOf (visível se QUALQUER uma estiver ligada) — ex.: Propostas,
 *  que aparece se vendas.propostas OU locacao.propostas. */
type Requires = string | string[];
/** Gate de RBAC do item. Array = anyOf. Ortogonal ao gate de módulo (`requires`). */
type RequiresPermission = PermissionKey | PermissionKey[];
type SubItem = {
  title: string;
  url: string;
  exact?: boolean;
  requires?: Requires;
  permission?: RequiresPermission;
};
type NavSimple = {
  kind: "item";
  title: string;
  url: string;
  icon: LucideIcon;
  requires?: Requires;
  permission?: RequiresPermission;
};
type NavGroup = {
  kind: "group";
  title: string;
  icon: LucideIcon;
  /** Gate de módulo/feature do grupo inteiro (além do filtro por sub-item). */
  requires?: Requires;
  permission?: RequiresPermission;
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

/**
 * `permission` ausente => sempre visível. Enquanto as permissões carregam,
 * fail-open: o menu não pisca nem some entre o primeiro paint e o fetch.
 */
function permissionAllowed(
  can: (permission: PermissionKey) => boolean,
  loading: boolean,
  permission?: RequiresPermission
): boolean {
  if (!permission) return true;
  if (loading) return true;
  return Array.isArray(permission) ? permission.some(can) : can(permission);
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
    title: "Pesquisas",
    icon: ClipboardCheck,
    requires: [FEATURE.VENDAS_PESQUISAS, FEATURE.LOCACAO_PESQUISAS],
    items: [
      { title: "Modelos", url: "/pesquisas", exact: true },
      { title: "Relatórios", url: "/pesquisas/relatorios" },
    ],
  },
  {
    kind: "group",
    title: "Financeiro",
    icon: Wallet,
    requires: FEATURE.VENDAS_PAGADORIA,
    // RBAC (2026-07, feature Gerente): sem NENHUMA leitura financeira o grupo
    // some. CHARGE_VIEW_OWN_DEALS_ONLY entra no anyOf pra não regredir o
    // corretor (`sales`), que hoje opera as cobranças dos próprios deals.
    permission: [
      PERMISSION.FINANCE_BALANCE_VIEW,
      PERMISSION.CHARGE_VIEW_ALL,
      PERMISSION.CHARGE_VIEW_OWN_DEALS_ONLY,
    ],
    items: [
      { title: "Cobranças", url: "/financeiro/cobrancas" },
      {
        title: "Clientes",
        url: "/financeiro/clientes",
        // anyOf com o escopo próprio: o corretor mantém a carteira dele.
        permission: [
          PERMISSION.CUSTOMER_VIEW_ALL,
          PERMISSION.CUSTOMER_VIEW_OWN_DEALS,
        ],
      },
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
    // Perfil/Segurança ficam SEM gate (todo membro precisa deles). Os itens de
    // configuração da ORG pedem ORG_SETTINGS_READ — o preset `gerente` tem a
    // chave, então nada muda pra ele; some só pra vistoriador/portais.
    items: [
      { title: "Meu perfil", url: "/settings/profile" },
      {
        title: "Membros",
        url: "/settings/membros",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Gerentes",
        url: "/settings/gerentes",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      { title: "Segurança", url: "/settings/seguranca" },
      {
        title: "Base de conhecimento",
        url: "/settings/knowledge-base",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Estilos de documento",
        url: "/settings/document-styles",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Formulário",
        url: "/settings/formulario",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      { title: "Notificações", url: "/settings/notificacoes" },
      {
        title: "Contas bancárias",
        url: "/settings/pagamentos/contas",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Destinatários de split",
        url: "/settings/pagamentos/split-recipients",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Assinaturas",
        url: "/settings/signatures",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Certidões",
        url: "/settings/certidoes",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Uso de IA",
        url: "/settings/ai-usage",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "API tokens",
        url: "/settings/api-tokens",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        title: "Uso da API",
        url: "/settings/api-usage",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
      {
        // Conexão do Google Drive da imobiliária. A página existe desde sempre e
        // o hub `/settings` já a lista, mas ela nunca tinha entrada no submenu —
        // e é pra cá que apontam o onboarding (lib/onboarding/steps.ts) e as
        // mensagens de erro de Drive expirado (lib/google/auth-error.ts).
        title: "Integrações",
        url: "/settings/integracoes",
        permission: PERMISSION.ORG_SETTINGS_READ,
      },
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
  const { can, loading: permsLoading } = usePermissions();
  // Override manual de abertura por grupo; quando indefinido, deriva da rota ativa.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});

  // Filtra a navegação por DOIS eixos: entitlements da org (`requires`) e RBAC
  // do usuário (`permission`). Grupos somem se não sobrar nenhum filho visível.
  const visibleNav = NAV.flatMap((entry): NavEntry[] => {
    const allowed =
      requiresEnabled(modules, entry.requires) &&
      permissionAllowed(can, permsLoading, entry.permission);
    if (entry.kind === "item") {
      return allowed ? [entry] : [];
    }
    if (!allowed) return [];
    const items = entry.items.filter(
      (it) =>
        requiresEnabled(modules, it.requires) &&
        permissionAllowed(can, permsLoading, it.permission)
    );
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
