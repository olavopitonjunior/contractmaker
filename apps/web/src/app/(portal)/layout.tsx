import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { Building2, LogOut } from "lucide-react";

/**
 * Layout do portal (owner/tenant) — mobile-first, sem sidebar/full chrome.
 * Header minimalista com brand + logout. Auth requerida.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-5 w-5 text-primary" />
            imobpro.ai · Portal
          </Link>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{session.user.email}</span>
            <Link href="/logout" className="flex items-center gap-1 hover:text-foreground">
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
