import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getImpersonationFor } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { getTenantBranding, getOrgBrand } from "@/lib/tenant/branding";
import { getOrgModules } from "@/lib/modules/read";
import { getOnboardingStatus, type OnboardingStatus } from "@/lib/onboarding/status";
import { canSeeOnboarding } from "@/lib/onboarding/gate";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardHeader } from "@/components/layout/dashboard-header";
import { AIAssistButton } from "@/components/ai-assist/AIAssistButton";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { TenantSwitcher } from "@/components/admin/TenantSwitcher";
import { getPlatformRole } from "@/lib/security/rbac/platform";

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
  // O contexto traz `endsAt`: o banner mostra a hora e vigia o vencimento —
  // sem isso a tela seguia afirmando "você está operando X" com a sessão já
  // vencida enquanto as rotas respondiam 404 (issue #587).
  const impersonation = org ? await getImpersonationFor(session.user.id) : null;
  const impersonating = impersonation !== null;
  // Onboarding: checklist "Primeiros passos" na sidebar — só pra OWNER/ADMIN com
  // o onboarding em aberto (`onboardingCompletedAt` null). Gate barato primeiro
  // (flag + role) — o status completo (~6 counts) só roda nessa janela.
  let onboarding: OnboardingStatus | null = null;
  if (org && !org.onboardingCompletedAt) {
    if (await canSeeOnboarding(session.user.id, org.id)) {
      onboarding = await getOnboardingStatus(org.id);
    }
  }
  // Switcher de tenant: só pra staff de plataforma com super_admin. A lista de
  // orgs é montada aqui (server) — o header é client e não pode consultar
  // PlatformRole. `homeOrg` é a org de origem do admin (1ª membership), pra onde
  // o item "minha org" volta encerrando a impersonation.
  const platform = await getPlatformRole(session.user.id);
  let tenantSwitcher: React.ReactNode = null;
  if (platform?.role === "super_admin") {
    const [orgs, homeMembership] = await Promise.all([
      prisma.organization.findMany({
        select: { id: true, name: true, subdomain: true, suspendedAt: true },
        orderBy: { name: "asc" },
      }),
      prisma.orgMembership.findFirst({
        where: { userId: session.user.id },
        select: { orgId: true },
        orderBy: [{ invitedAt: "asc" }, { id: "asc" }],
      }),
    ]);
    tenantSwitcher = (
      <TenantSwitcher
        orgs={orgs.map((o) => ({
          id: o.id,
          name: o.name,
          subdomain: o.subdomain,
          suspended: o.suspendedAt != null,
        }))}
        currentOrgId={org?.id ?? null}
        homeOrgId={homeMembership?.orgId ?? null}
        impersonating={impersonating}
      />
    );
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
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-1 focus:text-sm focus:text-primary-foreground focus:shadow-md focus:outline-hidden"
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
          {impersonation && org && (
            <ImpersonationBanner
              orgId={org.id}
              orgName={org.name}
              endsAt={impersonation.endsAt.toISOString()}
            />
          )}
          <DashboardHeader tenantSwitcher={tenantSwitcher} modules={modules} />
          {/* pb-24: folga pro AIAssistButton (fixed bottom-6 right-6) não
              cobrir ações no fim da página em viewport estreita. */}
          <main id="main-content" tabIndex={-1} className="flex-1 p-4 pb-24 sm:p-6 sm:pb-24">
            {children}
          </main>
        </SidebarInset>
        <AIAssistButton />
      </SidebarProvider>
    </div>
  );
}
