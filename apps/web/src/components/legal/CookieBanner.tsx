"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Cookie, X } from "lucide-react";

const STORAGE_KEY = "contractmaker:cookie-consent:v1";

type ConsentState = "accepted" | "declined" | null;

/**
 * Banner de cookies LGPD — exibido apenas em páginas públicas no primeiro
 * acesso. Persiste decisão em localStorage.
 *
 * "Aceitar" → permite cookies analíticos opcionais (futuro).
 * "Apenas essenciais" → só cookies estritamente necessários (auth, CSRF).
 */
export function CookieBanner() {
  const [state, setState] = useState<ConsentState>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "accepted" || saved === "declined") {
        setState(saved);
      }
    } catch {
      /* localStorage indisponível (SSR ou modo privado) — não exibe banner */
    }
  }, []);

  function decide(choice: "accepted" | "declined") {
    setState(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* ignore */
    }
  }

  if (!mounted || state !== null) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 bg-white border-2 border-primary shadow-lg rounded-lg p-4"
    >
      <div className="flex items-start gap-3">
        <Cookie className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <h2 id="cookie-banner-title" className="text-sm font-semibold">
            Este site usa cookies
          </h2>
          <p className="text-xs text-muted-foreground">
            Usamos cookies essenciais para autenticação e segurança. Cookies
            analíticos são opcionais e ajudam a melhorar a plataforma. Você
            pode revogar o consentimento a qualquer momento.{" "}
            <Link href="/privacy" className="underline">
              Saiba mais
            </Link>
            .
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => decide("declined")}
            >
              Apenas essenciais
            </Button>
            <Button size="sm" onClick={() => decide("accepted")}>
              Aceitar todos
            </Button>
          </div>
        </div>
        <button
          aria-label="Fechar"
          onClick={() => decide("declined")}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
