"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Bell } from "lucide-react";

const BREADCRUMB_MAP: Record<string, string> = {
  "/pipeline": "Pipeline de Vendas",
  "/forms": "Formularios",
  "/forms/new": "Novo Formulario",
  "/contracts": "Contratos",
  "/clauses": "Biblioteca de Clausulas",
  "/templates": "Templates",
  "/settings": "Configuracoes",
};

function getBreadcrumb(pathname: string): string {
  if (BREADCRUMB_MAP[pathname]) return BREADCRUMB_MAP[pathname];
  if (pathname.startsWith("/deals/")) return "Detalhe do Negocio";
  if (pathname.startsWith("/contracts/")) return "Editor de Contrato";
  return "Dashboard";
}

export function DashboardHeader() {
  const pathname = usePathname();
  const breadcrumb = getBreadcrumb(pathname);

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 sm:px-6">
      <SidebarTrigger className="-ml-2" />
      <Separator orientation="vertical" className="h-6" />

      <span className="text-sm font-medium text-foreground">{breadcrumb}</span>

      <div className="ml-auto flex items-center gap-3">
        <div className="relative hidden sm:block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            className="pl-9 w-[200px] lg:w-[260px] h-9 text-sm"
          />
        </div>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
