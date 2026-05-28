"use client";

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
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandWordmark } from "@/components/layout/brand-mark";
import {
  LayoutDashboard,
  BookOpen,
  FileStack,
  Settings,
  LogOut,
  Wallet,
  Building2,
} from "lucide-react";

const navItems = [
  {
    title: "Pipeline",
    url: "/pipeline",
    icon: LayoutDashboard,
  },
  {
    title: "Locação",
    url: "/locacao",
    icon: Building2,
  },
  {
    title: "Cláusulas",
    url: "/clauses",
    icon: BookOpen,
  },
  {
    title: "Templates",
    url: "/templates",
    icon: FileStack,
  },
  {
    title: "Financeiro",
    url: "/financeiro",
    icon: Wallet,
  },
  {
    title: "Configurações",
    url: "/settings",
    icon: Settings,
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

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();

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
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.url)}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
