import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
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

  return (
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
  );
}
