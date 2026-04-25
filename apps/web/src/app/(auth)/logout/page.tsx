"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";

export default function LogoutPage() {
  useEffect(() => {
    (async () => {
      // Limpeza server-side primeiro: revoga elevation (sudo), apaga sessões DB,
      // registra audit LOGOUT. Idempotente — roda mesmo sem sessão ativa.
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => {
        // Falha não bloqueia logout — signOut limpa o cookie de sessão.
      });
      await signOut({ callbackUrl: "/login" });
    })();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Encerrando sua sessão...</p>
      </div>
    </div>
  );
}
