import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getTenantBranding } from "@/lib/tenant/branding";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardHeader } from "@/components/layout/dashboard-header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // White-label (Fase 1a): resolve a org pelo subdomínio (header do middleware)
  // e injeta as cores do tenant como CSS vars no wrapper [data-tenant]. Sem cor
  // custom, nada é sobrescrito → paleta padrão Zimmermann.
  const subdomainHint = headers().get("x-org-subdomain");
  const org = await getUserOrg(session.user.id, { subdomainHint });
  const branding = org ? await getTenantBranding(org.id) : null;
  const tenantStyle: CSSProperties | undefined =
    branding && (branding.primaryHsl || branding.accentHsl)
      ? ({
          ...(branding.primaryHsl ? { "--primary": branding.primaryHsl } : {}),
          ...(branding.accentHsl ? { "--brand-accent": branding.accentHsl } : {}),
        } as CSSProperties)
      : undefined;

  return (
    <div
      className="contents"
      data-tenant={org?.subdomain ?? org?.id ?? undefined}
      style={tenantStyle}
    >
      <SidebarProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-1 focus:text-sm focus:text-primary-foreground focus:shadow-md focus:outline-none"
        >
          Pular para o conteúdo
        </a>
        <AppSidebar user={session.user} />
        <SidebarInset>
          <DashboardHeader />
          <main id="main-content" tabIndex={-1} className="flex-1 p-4 sm:p-6">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
