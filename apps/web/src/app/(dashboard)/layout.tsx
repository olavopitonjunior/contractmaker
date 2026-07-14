import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { isImpersonating, getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getTenantBranding, getOrgBrand } from "@/lib/tenant/branding";
import { getOrgModules } from "@/lib/modules/read";
import { getOnboardingStatus, type OnboardingStatus } from "@/lib/onboarding/status";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardHeader } from "@/components/layout/dashboard-header";
import { AIAssistButton } from "@/components/ai-assist/AIAssistButton";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";

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
  // Suspensão administrativa (painel super-admin): org suspensa bloqueia todo o
  // acesso ao dashboard. O painel /admin (fora deste layout) segue acessível.
  if (org?.suspendedAt) {
    redirect("/suspenso");
  }
  const branding = org ? await getTenantBranding(org.id) : null;
  // Marca da imobiliária no topo da sidebar (logo do tenant quando houver).
  const brand = org ? await getOrgBrand(org.id) : null;
  // Entitlements de módulos da org → filtram a navegação na sidebar.
  const modules = org ? await getOrgModules(org.id) : null;
  // "Testar como": super_admin operando este tenant como o dono → banner de aviso.
  const impersonating = org ? await isImpersonating(session.user.id) : false;
  // Onboarding: checklist "Primeiros passos" na sidebar — só pra OWNER com o
  // onboarding em aberto (`onboardingCompletedAt` null). Gate barato primeiro
  // (flag + role) — o status completo (~6 counts) só roda nessa janela.
  let onboarding: OnboardingStatus | null = null;
  if (org && !org.onboardingCompletedAt) {
    const effUserId = await getEffectiveUserId(session.user.id);
    const membership = await prisma.orgMembership.findFirst({
      where: { userId: effUserId, orgId: org.id },
      select: { role: true },
    });
    if (membership?.role === "owner") {
      onboarding = await getOnboardingStatus(org.id);
    }
  }
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
        <AppSidebar
          user={session.user}
          modules={modules}
          onboarding={onboarding}
          brand={brand ? { logoUrl: brand.logoUrl, displayName: brand.displayName } : null}
        />
        <SidebarInset>
          {impersonating && org && <ImpersonationBanner orgId={org.id} />}
          <DashboardHeader />
          <main id="main-content" tabIndex={-1} className="flex-1 p-4 sm:p-6">
            {children}
          </main>
        </SidebarInset>
        <AIAssistButton />
      </SidebarProvider>
    </div>
  );
}
